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

/**
 * Constant-time string comparison.
 *
 * A plain `===` on a secret leaks its prefix through timing: an attacker who
 * can measure response latency learns how many leading characters matched and
 * can recover the key one character at a time. This always walks the full
 * length of both inputs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  // Fold the length difference into the result rather than returning early,
  // so a wrong-length guess costs the same as a wrong-value one.
  let diff = aBytes.length ^ bBytes.length;
  const max = Math.max(aBytes.length, bBytes.length);

  for (let i = 0; i < max; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }

  return diff === 0;
}

export type ServiceRoleResult =
  | { ok: true }
  | { ok: false; message: string; logReason: string };

export function verifyServiceRoleToken(
  authHeader: string | null | undefined,
  serviceRoleKey: string,
  legacyServiceRoleJwt?: string,
): ServiceRoleResult {
  if (!serviceRoleKey && !legacyServiceRoleJwt) {
    // Refuse rather than allow. If no secret is configured the safe reading is
    // "misconfigured", never "skip the check".
    return {
      ok: false,
      message: "Service unavailable",
      logReason: "No service role credential configured; refusing all requests",
    };
  }

  const bearer = extractBearerToken(authHeader);
  if (!bearer.ok) {
    return {
      ok: false,
      message: "Not authorized",
      logReason: bearer.message,
    };
  }

  // Accept either configured credential, compared in constant time.
  //
  // This project has two valid service-role keys in circulation and they are
  // NOT equal: the Edge runtime exposes SUPABASE_SERVICE_ROLE_KEY as the newer
  // 41-character `sb_secret_…` form, while Vault still holds the legacy
  // 219-character JWT that pg_cron and every function-to-function call send.
  // Matching only the env value rejects the real cron — verified the hard way,
  // by doing exactly that and watching run_transfer_poll_batch() get a 401.
  //
  // Deliberately a secret comparison, not a JWT `role` claim check: the claim
  // sits in an unsigned payload, so anyone could mint a token asserting
  // `role: service_role`.
  if (serviceRoleKey && timingSafeEqual(bearer.token, serviceRoleKey)) {
    return { ok: true };
  }

  if (legacyServiceRoleJwt && timingSafeEqual(bearer.token, legacyServiceRoleJwt)) {
    return { ok: true };
  }

  return {
    ok: false,
    message: "Not authorized",
    logReason: "Bearer token did not match any configured service role credential",
  };
}
