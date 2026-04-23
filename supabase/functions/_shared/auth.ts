/**
 * Authentication utilities for Edge Functions
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { errorResponse, ErrorCodes } from "./response.ts";
import { extractBearerToken, resolveUserIdFromToken } from "./auth-core.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

