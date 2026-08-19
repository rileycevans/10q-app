import { describe, expect, it, vi } from "vitest";
import {
  extractBearerToken,
  resolveUserIdFromToken,
  timingSafeEqual,
  verifyServiceRoleToken,
} from "../../functions/_shared/auth-core.ts";

describe("extractBearerToken", () => {
  it("accepts a well-formed Bearer header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toEqual({
      ok: true,
      token: "abc.def.ghi",
    });
  });

  it("accepts case-insensitive scheme", () => {
    expect(extractBearerToken("bearer abc")).toEqual({ ok: true, token: "abc" });
    expect(extractBearerToken("BEARER abc")).toEqual({ ok: true, token: "abc" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractBearerToken("  Bearer abc  ")).toEqual({
      ok: true,
      token: "abc",
    });
  });

  it("rejects null/undefined headers", () => {
    expect(extractBearerToken(null)).toEqual({
      ok: false,
      message: "Missing Authorization header",
    });
    expect(extractBearerToken(undefined)).toEqual({
      ok: false,
      message: "Missing Authorization header",
    });
  });

  it("rejects empty header", () => {
    expect(extractBearerToken("").ok).toBe(false);
  });

  it("rejects header without scheme", () => {
    expect(extractBearerToken("abc.def.ghi").ok).toBe(false);
  });

  it("rejects the wrong scheme", () => {
    expect(extractBearerToken("Basic abc.def").ok).toBe(false);
  });

  it("rejects a Bearer header with no token body", () => {
    // No group-1 match at all.
    expect(extractBearerToken("Bearer").ok).toBe(false);
    // Matches the shape but the token whitespace-trims to empty.
    expect(extractBearerToken("Bearer  \t").ok).toBe(false);
  });
});

describe("resolveUserIdFromToken", () => {
  it("returns ok with the user id on success", async () => {
    const resolver = vi.fn().mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    });

    const result = await resolveUserIdFromToken("tok", resolver);

    expect(result).toEqual({ ok: true, userId: "user-123" });
    expect(resolver).toHaveBeenCalledWith("tok");
  });

  it("returns a normalized failure when the resolver surfaces an error", async () => {
    const resolver = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: "jwt expired", status: 401 },
    });

    const result = await resolveUserIdFromToken("tok", resolver);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("jwt expired");
    expect(result.logMessage).toContain("jwt expired");
  });

  it("returns a 'no user found' failure when the resolver succeeds but yields null", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: null });

    const result = await resolveUserIdFromToken("tok", resolver);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/no user/i);
  });

  it("prioritizes error over the null-user path", async () => {
    const resolver = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: "nope" },
    });

    const result = await resolveUserIdFromToken("tok", resolver);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("nope");
  });
});

/**
 * Machine-to-machine auth for the transfers pipeline.
 *
 * poll-tweets-batch is fired by pg_cron (which reads the service role key from
 * Vault), fans out to poll-tweets, which POSTs to ingest-claim — every hop
 * already sends `Authorization: Bearer <service role key>`. These functions
 * simply never verified it, and because config.toml sets verify_jwt = false
 * fleet-wide, a missing in-function check fails OPEN.
 */
describe("verifyServiceRoleToken", () => {
  const KEY = "service-role-key-abc123";

  it("accepts the exact service role key", () => {
    expect(verifyServiceRoleToken(`Bearer ${KEY}`, KEY)).toEqual({ ok: true });
  });

  it("accepts the scheme in any casing", () => {
    expect(verifyServiceRoleToken(`bearer ${KEY}`, KEY).ok).toBe(true);
    expect(verifyServiceRoleToken(`BEARER ${KEY}`, KEY).ok).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    const result = verifyServiceRoleToken(null, KEY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.logReason).toMatch(/missing/i);
  });

  it("rejects the anon key or any other token", () => {
    expect(verifyServiceRoleToken("Bearer anon-key-xyz", KEY).ok).toBe(false);
  });

  it("rejects a near-miss (prefix of the real key)", () => {
    expect(verifyServiceRoleToken(`Bearer ${KEY.slice(0, -1)}`, KEY).ok).toBe(false);
  });

  it("rejects the key with extra trailing characters", () => {
    expect(verifyServiceRoleToken(`Bearer ${KEY}x`, KEY).ok).toBe(false);
  });

  it("does not leak which check failed in the user-facing message", () => {
    const noHeader = verifyServiceRoleToken(null, KEY);
    const wrongKey = verifyServiceRoleToken("Bearer wrong", KEY);
    expect(noHeader.ok).toBe(false);
    expect(wrongKey.ok).toBe(false);
    if (noHeader.ok || wrongKey.ok) return;
    // Same message out, different reason logged.
    expect(noHeader.message).toBe(wrongKey.message);
    expect(noHeader.logReason).not.toBe(wrongKey.logReason);
  });

  it("fails CLOSED when no service role credential is configured", () => {
    // The dangerous alternative is treating an unset secret as "no check
    // needed", which would leave the endpoint wide open in exactly the
    // environment where something is already misconfigured.
    const result = verifyServiceRoleToken(`Bearer ${KEY}`, "", "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.logReason).toMatch(/no service role credential/i);
  });

  it("does not accept an empty bearer token against an empty key", () => {
    expect(verifyServiceRoleToken("Bearer ", "").ok).toBe(false);
  });

  // This project has two genuine service-role credentials that are not equal:
  // the Edge runtime holds the 41-char sb_secret_ form, while Vault and every
  // internal caller still send the 219-char legacy JWT. Matching only the env
  // value 401s the real cron — which is exactly what happened in production
  // before this case existed.
  describe("dual credentials", () => {
    const NEW_KEY = "sb_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const LEGACY_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

    it("accepts the runtime env key", () => {
      expect(verifyServiceRoleToken(`Bearer ${NEW_KEY}`, NEW_KEY, LEGACY_JWT).ok)
        .toBe(true);
    });

    it("accepts the legacy JWT that pg_cron actually sends", () => {
      expect(verifyServiceRoleToken(`Bearer ${LEGACY_JWT}`, NEW_KEY, LEGACY_JWT).ok)
        .toBe(true);
    });

    it("still rejects anything that is neither", () => {
      expect(verifyServiceRoleToken("Bearer nope", NEW_KEY, LEGACY_JWT).ok)
        .toBe(false);
    });

    it("rejects a forged JWT asserting role: service_role", () => {
      // The role claim is never trusted on its own — it lives in an unsigned
      // payload, so anyone can mint one. Only a match against a configured
      // secret passes.
      const forged =
        "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.attacker";
      expect(verifyServiceRoleToken(`Bearer ${forged}`, NEW_KEY, LEGACY_JWT).ok)
        .toBe(false);
    });

    it("works when only the legacy JWT is configured", () => {
      expect(verifyServiceRoleToken(`Bearer ${LEGACY_JWT}`, "", LEGACY_JWT).ok)
        .toBe(true);
    });
  });
});

describe("timingSafeEqual", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("handles differing lengths without throwing", () => {
    expect(timingSafeEqual("short", "muchlongerstring")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("a", "")).toBe(false);
  });

  it("handles multi-byte characters", () => {
    expect(timingSafeEqual("kéy—ü", "kéy—ü")).toBe(true);
    expect(timingSafeEqual("kéy—ü", "kéy—v")).toBe(false);
  });
});
