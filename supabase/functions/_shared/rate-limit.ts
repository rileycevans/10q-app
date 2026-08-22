/**
 * Per-caller throttling for the unauthenticated endpoints.
 *
 * Narrow on purpose. The migration plan defers general rate limiting to its
 * own workstream because a bespoke per-function limiter gets thrown away, and
 * that still holds — this is the smallest thing that closes two specific
 * holes:
 *
 *   - get-profile-by-handle is unauthenticated, service-role, and a heavy
 *     multi-join measured at 2.27s per call. The cheapest DoS surface here.
 *   - Handles became guessable across a ~250k space when auto-generated ones
 *     stopped deriving from the auth UUID, so the same endpoint is also the
 *     way to enumerate the player base.
 *
 * Easy to delete when edge-level throttling or a real limiter replaces it.
 */

import { errorResponse, ErrorCodes } from "./response.ts";

/**
 * Identify the caller.
 *
 * Behind Supabase's gateway the client address is in a forwarding header.
 * `x-forwarded-for` may be a chain, and the first entry is the original
 * client — later ones are proxies.
 *
 * Spoofable, and that is accepted: the aim is to make casual enumeration and
 * accidental hammering impractical, not to stop a determined attacker who
 * rotates addresses. Doing better needs infrastructure this deliberately does
 * not build.
 */
export function callerKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

export interface RateLimitOptions {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Returns a 429 Response to short-circuit on, or null to continue.
 *
 * Fails OPEN. If the limiter itself errors — the table is missing, the
 * database is briefly unreachable — the request proceeds. A throttle that
 * takes the endpoint down when it breaks is worse than the abuse it prevents.
 */
export async function enforceRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  req: Request,
  endpoint: string,
  requestId: string,
  { limit, windowSeconds }: RateLimitOptions,
): Promise<Response | null> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_bucket_key: callerKey(req),
      p_endpoint: endpoint,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) return null; // fail open
    if (data === true) return null;

    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Too many requests. Please slow down and try again shortly.",
      requestId,
      429,
      undefined,
      req,
    );
  } catch {
    return null; // fail open
  }
}
