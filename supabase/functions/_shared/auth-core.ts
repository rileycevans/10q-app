/**
 * Pure auth helpers for edge functions.
 *
 * The handler-level `getAuthenticatedUser` (in ./auth.ts) wires these up to a
 * real Supabase client. Keeping the token-parsing and user-resolution logic
 * here — free of `Deno.env` and `esm.sh` imports — lets us unit-test it.
 */

export type BearerResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

/**
 * Extract a Bearer token from an `Authorization` header.
 * Accepts the scheme with any casing and tolerates surrounding whitespace.
 */
export function extractBearerToken(
  authHeader: string | null | undefined,
): BearerResult {
  if (!authHeader) {
    return { ok: false, message: "Missing Authorization header" };
  }

  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, message: "Missing Authorization header" };
  }

  const token = match[1].trim();
  if (!token) {
    return { ok: false, message: "Missing Authorization header" };
  }

  return { ok: true, token };
}

export interface AuthUserResponse {
  data: { user: { id: string } | null };
  error: { message: string; status?: number } | null;
}

export type UserResolver = (token: string) => Promise<AuthUserResponse>;

export type ResolveUserResult =
  | { ok: true; userId: string }
  | { ok: false; message: string; logMessage: string };

/**
 * Given a bearer token and a user-resolver (typically `supabase.auth.getUser`),
 * return either the resolved user id or a normalized failure with both a
 * user-facing message and a server log message.
 */
export async function resolveUserIdFromToken(
  token: string,
  resolver: UserResolver,
): Promise<ResolveUserResult> {
  const { data, error } = await resolver(token);

  if (error) {
    return {
      ok: false,
      message: `Token validation failed: ${error.message}`,
      logMessage: `Token validation error: ${error.message}`,
    };
  }

  if (!data?.user) {
    return {
      ok: false,
      message: "Invalid token: no user found",
      logMessage: "No user returned from token validation",
    };
  }

  return { ok: true, userId: data.user.id };
}
