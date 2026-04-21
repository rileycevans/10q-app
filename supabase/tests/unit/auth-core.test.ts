import { describe, expect, it, vi } from "vitest";
import {
  extractBearerToken,
  resolveUserIdFromToken,
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
