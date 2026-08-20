/**
 * Minimum-supported-client gate.
 *
 * Store binaries stay installed indefinitely against a continuously-deployed
 * backend, and a native client cannot be rolled back. This is the only lever
 * that works when a shipped binary must stop being served — see
 * docs/cross-platform/release/VERSIONING.md §8.
 *
 * The floor lives in Edge Function secrets rather than code, because *raising*
 * it is the dangerous operation and *lowering* it must therefore be instant:
 *
 *   supabase secrets set MIN_CLIENT_IOS=1.3.0
 *   supabase secrets set MIN_CLIENT_IOS=0.0.0     # instant revert, no deploy
 *
 * A code-resident floor would need a manual redeploy of every function to undo
 * a mistake — during the incident the mistake caused.
 *
 * Default is 0.0.0 on every platform, which disables the gate entirely. That
 * is deliberate: the gate ships inert and is armed later, after measuring real
 * client versions (§8.5). Shipping it armed would brick clients on day one.
 */

import { errorResponse, ErrorCodes } from "./response.ts";

export type ClientPlatform = "web" | "ios" | "android";

export interface ParsedClientVersion {
  platform: ClientPlatform;
  version: string;
  build: string;
}

/** `<platform>/<major.minor.patch>+<build>` — see src/lib/version.ts. */
const PATTERN = /^(web|ios|android)\/(\d+\.\d+\.\d+)\+([A-Za-z0-9._-]+)$/;

export function parseClientVersion(req: Request): ParsedClientVersion | null {
  const raw = req.headers.get("x-client-version");
  if (!raw) return null;
  const m = raw.match(PATTERN);
  return m
    ? { platform: m[1] as ClientPlatform, version: m[2], build: m[3] }
    : null;
}

/** Semver compare on MAJOR.MINOR.PATCH. Negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const [A, B] = [a, b].map((s) => s.split(".").map(Number));
  return (A[0] - B[0]) || (A[1] - B[1]) || (A[2] - B[2]);
}

/**
 * The configured floor for a platform, read from Edge Function secrets at
 * cold start. Unset means 0.0.0, which means the gate is off.
 */
export function configuredFloor(platform: string): string {
  const byPlatform: Record<string, string | undefined> = {
    web: Deno.env.get("MIN_CLIENT_WEB"),
    ios: Deno.env.get("MIN_CLIENT_IOS"),
    android: Deno.env.get("MIN_CLIENT_ANDROID"),
  };
  return byPlatform[platform] ?? "0.0.0";
}

/**
 * The highest floor configured across all platforms.
 *
 * Used only when the request carries no parseable version header. Such a
 * client cannot be attributed to a platform, and treating it as unconstrained
 * would invert the rule — it is the oldest possible client, not the newest.
 */
export function highestConfiguredFloor(): string {
  return ["web", "ios", "android"]
    .map(configuredFloor)
    .reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b), "0.0.0");
}

/**
 * Decide whether a request should be refused. Pure, so it is unit-testable
 * without a Request or Deno.env — the handler wrapper below supplies both.
 *
 * The effective floor is max(global floor, this function's declared minimum).
 *
 * An absent or unparseable header counts as below any non-zero floor: a client
 * that does not send the header predates the header, so it predates everything.
 * That is the intended semantics, and it is why §8.5 requires confirming zero
 * header-less requests before raising a floor above 0.0.0.
 */
export function evaluateClientVersion(
  client: ParsedClientVersion | null,
  globalFloor: string,
  functionMin = "0.0.0",
): { allowed: true } | { allowed: false; floor: string; platform: string } {
  const floor =
    compareVersions(globalFloor, functionMin) >= 0 ? globalFloor : functionMin;

  // Gate disabled — the default, and the state this ships in.
  if (floor === "0.0.0") return { allowed: true };

  const platform = client?.platform ?? "unknown";

  if (!client || compareVersions(client.version, floor) < 0) {
    return { allowed: false, floor, platform };
  }

  return { allowed: true };
}

/**
 * Handler guard. Returns a 426 Response to short-circuit on, or null to
 * continue — mirroring getAuthenticatedUser's shape.
 *
 * NOT every endpoint may be gated. 10Q gives each player one attempt per day
 * on a server-authoritative clock, so a gate that fires mid-attempt does not
 * inconvenience someone, it destroys their single daily play. Gate at the
 * door, never in the middle of the room:
 *
 *   gate:     get-current-quiz, start-attempt (preferred), leaderboards,
 *             profiles, league writes, update-handle
 *   NEVER:    start-question-timer, submit-answer, finalize-attempt,
 *             resume-attempt, delete-account
 *
 * delete-account is a compliance requirement (Apple 5.1.1(v), Google), so
 * blocking it is a store violation rather than a UX problem.
 */
export function requireMinimumClient(
  req: Request,
  requestId: string,
  functionMin: Partial<Record<ClientPlatform, string>> = {},
): Response | null {
  const client = parseClientVersion(req);

  // A header-less client has no platform, so there is no per-platform floor to
  // look up — and returning 0.0.0 there would let exactly the oldest clients
  // through, which is backwards. Fall back to the highest configured floor:
  // a client that does not send the header predates the header, so it predates
  // every platform's floor. (Spec: "absent or unparseable header is treated as
  // below any non-zero floor".)
  const globalFloor = client
    ? configuredFloor(client.platform)
    : highestConfiguredFloor();

  const fnMin = (client && functionMin[client.platform]) ?? "0.0.0";

  const verdict = evaluateClientVersion(client, globalFloor, fnMin);
  if (verdict.allowed) return null;

  return errorResponse(
    ErrorCodes.CLIENT_UPDATE_REQUIRED,
    "This version of 10Q is no longer supported. Please update to keep playing.",
    requestId,
    426,
    { minimum_version: verdict.floor, platform: verdict.platform },
    req,
  );
}
