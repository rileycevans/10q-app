/**
 * Unit tests for CORS origin handling (precondition 0D).
 *
 * The bug these guard against is not "CORS is misconfigured" — it is that one
 * static Access-Control-Allow-Origin cannot serve web and both Capacitor
 * shells, and that the resulting failure is invisible on web while killing the
 * entire game loop on native.
 *
 * `_shared/cors.ts` reads Deno.env at module load, so each case re-imports the
 * module with a fresh env rather than mutating shared state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MODULE = "../../functions/_shared/cors.ts";

/** Load cors.ts with a given ALLOWED_ORIGIN, bypassing the module cache. */
async function loadWithEnv(allowedOrigin: string | undefined) {
  vi.resetModules();
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno = {
    env: {
      get: (k: string) =>
        k === "ALLOWED_ORIGIN" ? allowedOrigin : undefined,
    },
  };
  return await import(MODULE);
}

function requestFrom(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  return new Request("https://example.test/functions/v1/start-attempt", {
    method: "POST",
    headers,
  });
}

// deno-lint-ignore no-explicit-any
const originalDeno = (globalThis as any).Deno;

afterEach(() => {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno = originalDeno;
});

describe("corsHeadersFor — with ALLOWED_ORIGIN set (the trap)", () => {
  const PROD = "https://play10q.com";

  it("echoes the web origin", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    const h = corsHeadersFor(requestFrom(PROD));
    expect(h["Access-Control-Allow-Origin"]).toBe(PROD);
  });

  // These four are the whole point of 0D. Before this change, setting
  // ALLOWED_ORIGIN pinned the header to play10q.com and every one of these
  // requests failed preflight — killing the game loop on device while leagues
  // and profiles (which hardcode "*") kept working.
  it("echoes the iOS Capacitor origin", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    const h = corsHeadersFor(requestFrom("capacitor://localhost"));
    expect(h["Access-Control-Allow-Origin"]).toBe("capacitor://localhost");
  });

  it("echoes the Android origin", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    const h = corsHeadersFor(requestFrom("http://localhost"));
    expect(h["Access-Control-Allow-Origin"]).toBe("http://localhost");
  });

  it("echoes the Android https-scheme origin", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    const h = corsHeadersFor(requestFrom("https://localhost"));
    expect(h["Access-Control-Allow-Origin"]).toBe("https://localhost");
  });

  it("allows local development", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    expect(
      corsHeadersFor(requestFrom("http://localhost:3000"))[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("http://localhost:3000");
  });

  it("refuses an origin that is not on the list", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    const h = corsHeadersFor(requestFrom("https://evil.example"));
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("does not match on prefix — a lookalike domain is refused", async () => {
    const { corsHeadersFor } = await loadWithEnv(PROD);
    const h = corsHeadersFor(requestFrom("https://play10q.com.evil.example"));
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("accepts a comma-separated list, so staging needs no code change", async () => {
    const { corsHeadersFor } = await loadWithEnv(
      "https://play10q.com, https://staging.play10q.com",
    );
    expect(
      corsHeadersFor(requestFrom("https://staging.play10q.com"))[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("https://staging.play10q.com");
  });
});

describe("corsHeadersFor — wildcard mode (production today)", () => {
  it("allows any origin when ALLOWED_ORIGIN is unset", async () => {
    const { corsHeadersFor } = await loadWithEnv(undefined);
    expect(
      corsHeadersFor(requestFrom("https://anything.example"))[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("https://anything.example");
  });

  it("allows the Capacitor origins too", async () => {
    const { corsHeadersFor } = await loadWithEnv(undefined);
    expect(
      corsHeadersFor(requestFrom("capacitor://localhost"))[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("capacitor://localhost");
  });

  it("treats an explicit '*' the same as unset", async () => {
    const { corsHeadersFor } = await loadWithEnv("*");
    expect(
      corsHeadersFor(requestFrom("https://anything.example"))[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("https://anything.example");
  });
});

describe("corsHeadersFor — always", () => {
  it("sets Vary: Origin so caches cannot cross-serve responses", async () => {
    const { corsHeadersFor } = await loadWithEnv("https://play10q.com");
    expect(corsHeadersFor(requestFrom("https://play10q.com")).Vary).toBe("Origin");
    // Present even on a refusal, or the refusal itself gets cached and served
    // to an allowed origin.
    expect(corsHeadersFor(requestFrom("https://evil.example")).Vary).toBe("Origin");
  });

  it("still advertises the headers the client actually sends", async () => {
    const { corsHeadersFor } = await loadWithEnv("https://play10q.com");
    const allowed = corsHeadersFor(requestFrom("https://play10q.com"))[
      "Access-Control-Allow-Headers"
    ];
    // A missing entry here fails preflight silently — the request never leaves
    // the browser and the server logs nothing.
    for (const h of ["authorization", "apikey", "content-type", "x-client-info"]) {
      expect(allowed).toContain(h);
    }
  });

  it("falls back to '*' when there is no Origin header (server-to-server)", async () => {
    const { corsHeadersFor } = await loadWithEnv("https://play10q.com");
    expect(
      corsHeadersFor(requestFrom(null))["Access-Control-Allow-Origin"],
    ).toBe("*");
  });
});

describe("corsHeaders (static export, kept for existing call sites)", () => {
  it("is '*' in wildcard mode, matching current production behaviour", async () => {
    const { corsHeaders } = await loadWithEnv(undefined);
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("falls back to the first configured origin once ALLOWED_ORIGIN is set", async () => {
    const { corsHeaders } = await loadWithEnv("https://play10q.com");
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("https://play10q.com");
  });
});

describe("isAllowedOrigin", () => {
  it("rejects a null origin", async () => {
    const { isAllowedOrigin } = await loadWithEnv("https://play10q.com");
    expect(isAllowedOrigin(null)).toBe(false);
  });

  it("is exact-match, not substring", async () => {
    const { isAllowedOrigin } = await loadWithEnv("https://play10q.com");
    expect(isAllowedOrigin("https://play10q.com")).toBe(true);
    expect(isAllowedOrigin("https://play10q.com/")).toBe(false);
    expect(isAllowedOrigin("http://play10q.com")).toBe(false);
  });
});
