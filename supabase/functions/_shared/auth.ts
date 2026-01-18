/**
 * Authentication utilities for Edge Functions
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { errorResponse, ErrorCodes } from "./response.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export async function getAuthenticatedUser(
  request: Request,
  requestId: string
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Missing Authorization header",
      requestId,
      401
    );
  }

  const token = authHeader.replace("Bearer ", "");
  
  // Use anon key to validate user tokens (tokens are signed with anon key)
  // Don't set Authorization header when calling getUser(token) - pass token directly
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error) {
    console.error(`[${requestId}] Token validation error:`, {
      error: error.message,
      errorCode: error.status,
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20),
    });
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      `Token validation failed: ${error.message}`,
      requestId,
      401
    );
  }

  if (!user) {
    console.error(`[${requestId}] No user returned from token validation`);
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Invalid token: no user found",
      requestId,
      401
    );
  }

  console.log(`[${requestId}] User authenticated: ${user.id}`);
  return { userId: user.id };
}

