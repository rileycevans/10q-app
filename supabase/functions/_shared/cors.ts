/**
 * CORS for Edge Functions.
 *
 * Precondition 0D. The previous version emitted a single static
 * `Access-Control-Allow-Origin` from `ALLOWED_ORIGIN`, which cannot serve web
 * and native at once: Capacitor sends `capacitor://localhost` on iOS and
 * `http://localhost` on Android, neither of which is `https://play10q.com`.
 *
 * The failure shape is the dangerous part. Fifteen functions import this and
 * they are exactly the game loop — start-attempt, submit-answer,
 * finalize-attempt, the leaderboards. The other ten hardcode `"*"` inline. So
 * with `ALLOWED_ORIGIN` set, leagues and profiles would keep working while
 * every quiz request failed, which reads like a client bug and costs a day to
 * diagnose.
 *
 * Measured 2026-08-19: `ALLOWED_ORIGIN` is NOT currently set in production, so
 * the fleet answers `*` and native would work today. That is luck, not design —
 * the file's own comment instructs an operator to set it, and doing so is what
 * breaks the game loop. This defuses the trap before anyone springs it.
 *
 * Approach: echo the request's Origin when it is on the allow-list, and always
 * send `Vary: Origin` so a cache never serves one origin's response to
 * another. Echoing rather than wildcarding matters because
 * `Access-Control-Allow-Origin: *` is incompatible with credentialed requests,
 * and it keeps the allow-list meaningful.
 */

/** Origins the Capacitor shells present. Fixed by the platforms, not by us. */
const CAPACITOR_ORIGINS = [
  "capacitor://localhost", // iOS
  "http://localhost", // Android (WebViewAssetLoader)
  "https://localhost", // Android, when androidScheme is https
];

/** Local development. */
const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/**
 * Build the allow-list. ALLOWED_ORIGIN keeps working and may now be a
 * comma-separated list, so adding a staging origin needs no code change.
 */
function buildAllowList(): string[] {
  const configured = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o !== "*");

  return [...configured, ...CAPACITOR_ORIGINS, ...DEV_ORIGINS];
}

const ALLOW_LIST = buildAllowList();

/**
 * True when ALLOWED_ORIGIN is unset or explicitly "*".
 *
 * Kept because it is the current production posture and tightening it is a
 * separate, deliberate decision — this change is about not breaking native
 * when someone makes it, not about making that call for them.
 */
const WILDCARD_MODE =
  !Deno.env.get("ALLOWED_ORIGIN") || Deno.env.get("ALLOWED_ORIGIN") === "*";

const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // Required whenever the response varies by request Origin. Without it a
  // shared cache can hand a capacitor:// response to a browser, or vice versa.
  Vary: "Origin",
} as const;

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (WILDCARD_MODE) return true;
  return ALLOW_LIST.includes(origin);
}

/**
 * CORS headers for a specific request. Prefer this over the static
 * `corsHeaders` export below.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");

  if (origin && isAllowedOrigin(origin)) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin };
  }

  // No Origin header at all — a server-to-server call, or curl. Nothing to
  // echo, and CORS does not apply, so the permissive value is harmless.
  if (!origin) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": "*" };
  }

  // A disallowed origin. Omit Access-Control-Allow-Origin entirely rather than
  // sending a value the browser will reject anyway; the browser blocks it and
  // the reason is legible in devtools.
  return { ...BASE_HEADERS };
}

/**
 * Static headers, preserved so the fifteen existing importers keep working.
 *
 * In wildcard mode (production today) this behaves exactly as before. Once
 * ALLOWED_ORIGIN is set it falls back to the first configured origin, which is
 * correct for web but NOT for native — so call sites should move to
 * `corsHeadersFor(req)`. Deliberately not deleted in one sweep: changing 25
 * call sites at once is how you break a game loop you cannot easily test.
 */
export const corsHeaders: Record<string, string> = {
  ...BASE_HEADERS,
  "Access-Control-Allow-Origin": WILDCARD_MODE ? "*" : (ALLOW_LIST[0] ?? "*"),
};
