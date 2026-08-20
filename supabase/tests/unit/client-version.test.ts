/**
 * Unit tests for the minimum-supported-client gate.
 *
 * This is the one mechanism in the codebase that can deliberately stop a
 * shipped app from working. Raising the floor too early bricks installed
 * binaries whose users cannot update on demand — App Store review latency is
 * real and auto-update is neither universal nor immediate. So the semantics
 * are pinned here rather than left to be rediscovered during an incident.
 *
 * The two properties that matter most:
 *   1. It ships INERT. An unset floor means 0.0.0 means the gate is off.
 *   2. A missing header counts as too old, because a client that does not send
 *      the header predates the header.
 */

import { describe, it, expect } from "vitest";

import { beforeAll } from "vitest";

// client-version.ts imports response.ts -> cors.ts, which reads Deno.env at
// module load. ES imports are hoisted, so the stub has to be in place before a
// dynamic import pulls the chain in. Same approach as cors.test.ts.
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: () => undefined } };

type Mod = typeof import("../../functions/_shared/client-version.ts");
let compareVersions: Mod["compareVersions"];
let evaluateClientVersion: Mod["evaluateClientVersion"];
let parseClientVersion: Mod["parseClientVersion"];
type ParsedClientVersion = Awaited<ReturnType<Mod["parseClientVersion"]>>;

beforeAll(async () => {
  const mod = await import("../../functions/_shared/client-version.ts");
  compareVersions = mod.compareVersions;
  evaluateClientVersion = mod.evaluateClientVersion;
  parseClientVersion = mod.parseClientVersion;
});

function req(headerValue?: string): Request {
  const headers = new Headers();
  if (headerValue !== undefined) headers.set("x-client-version", headerValue);
  return new Request("https://example.test/functions/v1/start-attempt", {
    method: "POST",
    headers,
  });
}

const webClient: NonNullable<ParsedClientVersion> = {
  platform: "web",
  version: "1.2.0",
  build: "abc1234",
};

describe("parseClientVersion", () => {
  it("parses the web form, where build is a SHA", () => {
    expect(parseClientVersion(req("web/1.2.0+abc1234"))).toEqual({
      platform: "web",
      version: "1.2.0",
      build: "abc1234",
    });
  });

  it("parses the native form, where build is an integer", () => {
    expect(parseClientVersion(req("ios/1.2.0+42"))).toEqual({
      platform: "ios",
      version: "1.2.0",
      build: "42",
    });
    expect(parseClientVersion(req("android/1.2.0+42"))?.platform).toBe("android");
  });

  it("returns null when the header is absent", () => {
    expect(parseClientVersion(req())).toBeNull();
  });

  it("returns null for a malformed header rather than guessing", () => {
    for (const bad of [
      "",
      "1.2.0",
      "web/1.2.0",
      "web/1.2+abc",
      "windows/1.2.0+abc",
      "web/1.2.0.1+abc",
      "web/v1.2.0+abc",
    ]) {
      expect(parseClientVersion(req(bad)), bad).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0); // not string order
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("evaluateClientVersion", () => {
  describe("ships inert", () => {
    it("allows everything when the floor is 0.0.0 — the default", () => {
      expect(evaluateClientVersion(webClient, "0.0.0")).toEqual({ allowed: true });
    });

    it("allows a header-less client when the gate is off", () => {
      // Critical: an unconfigured deployment must never block anyone, even a
      // client that sends no header at all.
      expect(evaluateClientVersion(null, "0.0.0")).toEqual({ allowed: true });
    });
  });

  describe("once a floor is configured", () => {
    it("allows a client at the floor", () => {
      expect(evaluateClientVersion(webClient, "1.2.0").allowed).toBe(true);
    });

    it("allows a client above the floor", () => {
      expect(evaluateClientVersion(webClient, "1.1.0").allowed).toBe(true);
    });

    it("refuses a client below the floor", () => {
      const v = evaluateClientVersion(webClient, "1.3.0");
      expect(v.allowed).toBe(false);
      if (v.allowed) return;
      expect(v.floor).toBe("1.3.0");
      expect(v.platform).toBe("web");
    });

    it("refuses a client with no header — it predates the header", () => {
      const v = evaluateClientVersion(null, "1.0.0");
      expect(v.allowed).toBe(false);
      if (v.allowed) return;
      expect(v.platform).toBe("unknown");
    });

    // Regression. The first implementation looked the floor up by
    // client.platform, which is undefined without a header — so it resolved to
    // 0.0.0 and let exactly the oldest clients straight through. Verified
    // against production before the fix: a header-less request returned 200
    // while web/1.0.0 was correctly refused. requireMinimumClient now falls
    // back to the highest configured floor for an unattributable client.
    it("a header-less client is measured against a floor, not exempted from one", () => {
      expect(evaluateClientVersion(null, "1.5.0").allowed).toBe(false);
      expect(evaluateClientVersion(null, "0.0.1").allowed).toBe(false);
    });
  });

  describe("effective floor is max(global, per-function)", () => {
    it("uses the per-function minimum when it is higher", () => {
      const v = evaluateClientVersion(webClient, "1.0.0", "1.5.0");
      expect(v.allowed).toBe(false);
      if (v.allowed) return;
      expect(v.floor).toBe("1.5.0");
    });

    it("uses the global floor when it is higher", () => {
      const v = evaluateClientVersion(webClient, "1.5.0", "1.1.0");
      expect(v.allowed).toBe(false);
      if (v.allowed) return;
      expect(v.floor).toBe("1.5.0");
    });

    it("a per-function minimum alone can gate while the global floor is off", () => {
      const v = evaluateClientVersion(webClient, "0.0.0", "1.3.0");
      expect(v.allowed).toBe(false);
    });

    it("but both being 0.0.0 still means off", () => {
      expect(evaluateClientVersion(null, "0.0.0", "0.0.0").allowed).toBe(true);
    });
  });

  describe("version ordering is numeric, not lexicographic", () => {
    it("1.10.0 is above a 1.9.0 floor", () => {
      const client = { ...webClient, version: "1.10.0" };
      expect(evaluateClientVersion(client, "1.9.0").allowed).toBe(true);
    });

    it("0.9.0 is below a 1.0.0 floor", () => {
      const client = { ...webClient, version: "0.9.0" };
      expect(evaluateClientVersion(client, "1.0.0").allowed).toBe(false);
    });
  });
});
