/**
 * Authentication utilities for Edge Functions
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { errorResponse, ErrorCodes } from "./response.ts";
import {
  extractBearerToken,
  resolveUserIdFromToken,
  verifyServiceRoleToken,
} from "./auth-core.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Optional second accepted credential, for the window where a caller still
// holds an older service-role key. Empty by default: with the Vault secret
// rotated to match SUPABASE_SERVICE_ROLE_KEY, nothing needs it. Kept because
// the two-valid-keys situation is exactly what broke the cron the first time,
// and a future rotation will hit it again.
const legacyServiceRoleJwt = Deno.env.get("LEGACY_SERVICE_ROLE_JWT") ?? "";

export async function getAuthenticatedUser(
  request: Request,
  requestId: string,
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");
  const tokenOrError = extractBearerToken(authHeader);

  if (!tokenOrError.ok) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      tokenOrError.message,
      requestId,
      401,
    );
  }

  // Use anon key to validate user tokens (tokens are signed with anon key)
  // Don't set Authorization header when calling getUser(token) - pass token directly
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const result = await resolveUserIdFromToken(
    tokenOrError.token,
    (token) => supabase.auth.getUser(token),
  );

  if (!result.ok) {
    console.error(`[${requestId}] ${result.logMessage}`);
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      result.message,
      requestId,
      401,
    );
  }

  console.log(`[${requestId}] User authenticated: ${result.userId}`);
  return { userId: result.userId };
}


/**
 * Gate a machine-to-machine endpoint on the service role key.
 *
 * Returns a Response to short-circuit with when the caller is not trusted
 * infrastructure, or null when the request may proceed — mirroring the shape
 * of `getAuthenticatedUser` above.
 *
 * Use this instead of `getAuthenticatedUser` for functions invoked by pg_cron
 * or by another Edge Function, where there is no signed-in user to check. The
 * failure message is deliberately generic: distinguishing "no header" from
 * "wrong key" in the response body would confirm to a prober that the endpoint
 * exists and is guarded by a key worth guessing. The specific reason is logged
 * server-side instead.
 */
export function requireServiceRole(
  request: Request,
  requestId: string,
): Response | null {
  const result = verifyServiceRoleToken(
    request.headers.get("Authorization"),
    supabaseServiceKey,
    legacyServiceRoleJwt,
  );

  if (!result.ok) {
    console.error(`[${requestId}] service-role check failed: ${result.logReason}`);
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      result.message,
      requestId,
      401,
    );
  }

  return null;
}
