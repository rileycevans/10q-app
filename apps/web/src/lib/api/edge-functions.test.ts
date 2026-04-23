/**
 * Tests for the edge-functions client wrapper.
 *
 * Focused on the cross-cutting behaviors that aren't obvious from reading
 * each endpoint:
 * - Auth-token resolution (missing session → NOT_AUTHORIZED; expired →
 *   refresh; refreshed success → attached).
 * - 401 response normalization to NOT_AUTHORIZED.
 * - Retry exhaustion on 503 re-maps error message via getUserFriendlyErrorMessage.
 * - Successful round-trip returns ok:true with data.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionShape = {
  access_token: string;
  expires_at: number | null;
};

const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => mockGetSession(...args),
            refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
        },
    },
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        generateRequestId: () => "req_test",
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    mockGetSession.mockReset();
    mockRefreshSession.mockReset();
});

afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
});

function mockFetchOnce(body: unknown, init: ResponseInit = { status: 200 }) {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
    );
    return fetchSpy;
}

function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>) {
    const fetchSpy = vi.spyOn(global, "fetch");
    responses.forEach(({ body, status = 200 }) => {
        fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            }) as unknown as Response,
        );
    });
    return fetchSpy;
}

function validSession(): SessionShape {
    // Token expires 1 hour in the future.
    return { access_token: "valid-token", expires_at: Math.floor(Date.now() / 1000) + 3600 };
}

async function loadModule() {
    const mod = await import("./edge-functions");
    return mod;
}

describe("edgeFunctions — auth-token resolution", () => {
    it("returns NOT_AUTHORIZED when there is no session", async () => {
        mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
        const fetchSpy = vi.spyOn(global, "fetch");
        const { edgeFunctions } = await loadModule();

        const res = await edgeFunctions.startAttempt("quiz-1");

        expect(res.ok).toBe(false);
        expect(res.error?.code).toBe("NOT_AUTHORIZED");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns NOT_AUTHORIZED when getSession surfaces a session error", async () => {
        mockGetSession.mockResolvedValueOnce({
            data: { session: null },
            error: { message: "boom" },
        });
        const fetchSpy = vi.spyOn(global, "fetch");
        const { edgeFunctions } = await loadModule();

        const res = await edgeFunctions.startAttempt("quiz-1");

        expect(res.ok).toBe(false);
        expect(res.error?.code).toBe("NOT_AUTHORIZED");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("attaches Bearer token when session is valid", async () => {
        mockGetSession.mockResolvedValueOnce({
            data: { session: validSession() },
            error: null,
        });
        const fetchSpy = mockFetchOnce({ ok: true, data: { attempt_id: "a1" } });
        const { edgeFunctions } = await loadModule();

        const res = await edgeFunctions.startAttempt("quiz-1");
        expect(res.ok).toBe(true);

        const call = fetchSpy.mock.calls[0]!;
        const [, init] = call;
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer valid-token");
    });

    it("refreshes an expired token and uses the refreshed token", async () => {
        const expired = {
            access_token: "expired-token",
            expires_at: Math.floor(Date.now() / 1000) - 10,
        };
        mockGetSession.mockResolvedValueOnce({ data: { session: expired }, error: null });
        mockRefreshSession.mockResolvedValueOnce({
            data: { session: { access_token: "refreshed-token", expires_at: null } },
            error: null,
        });
        const fetchSpy = mockFetchOnce({ ok: true, data: {} });
        const { edgeFunctions } = await loadModule();

        await edgeFunctions.startAttempt("quiz-1");

        expect(mockRefreshSession).toHaveBeenCalledTimes(1);
        const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer refreshed-token");
    });

    it("returns NOT_AUTHORIZED when refresh fails", async () => {
        const expired = {
            access_token: "expired",
            expires_at: Math.floor(Date.now() / 1000) - 10,
        };
        mockGetSession.mockResolvedValueOnce({ data: { session: expired }, error: null });
        mockRefreshSession.mockResolvedValueOnce({
            data: { session: null },
            error: { message: "refresh failed" },
        });
        const fetchSpy = vi.spyOn(global, "fetch");
        const { edgeFunctions } = await loadModule();

        const res = await edgeFunctions.startAttempt("quiz-1");

        expect(res.ok).toBe(false);
        expect(res.error?.code).toBe("NOT_AUTHORIZED");
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe("edgeFunctions — response normalization", () => {
    beforeEach(() => {
        mockGetSession.mockResolvedValue({
            data: { session: validSession() },
            error: null,
        });
    });

    it("returns ok:true with data on 2xx", async () => {
        mockFetchOnce({
            ok: true,
            data: { attempt_id: "a1", quiz_id: "q1" },
            request_id: "req-server",
        });
        const { edgeFunctions } = await loadModule();

        const res = await edgeFunctions.startAttempt("quiz-1");
        expect(res).toEqual({
            ok: true,
            data: { attempt_id: "a1", quiz_id: "q1" },
            request_id: "req-server",
        });
    });

    it("normalizes 401 to NOT_AUTHORIZED regardless of server-sent error code", async () => {
        mockFetchOnce(
            { ok: false, error: { code: "SOME_OTHER_CODE", message: "nope" }, request_id: "r" },
            { status: 401 },
        );
        const { edgeFunctions } = await loadModule();

        const res = await edgeFunctions
            .startAttempt("quiz-1")
            .catch((e: { error?: { code?: string } }) => e);

        // Thrown rather than returned — confirm error shape.
        expect(res.error?.code).toBe("NOT_AUTHORIZED");
    });
});

describe("edgeFunctions — retry behavior", () => {
    beforeEach(() => {
        mockGetSession.mockResolvedValue({
            data: { session: validSession() },
            error: null,
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("retries a 503 and succeeds on the second attempt", async () => {
        const fetchSpy = mockFetchSequence([
            { body: { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "busy" } }, status: 503 },
            { body: { ok: true, data: { attempt_id: "a1" } }, status: 200 },
        ]);
        const { edgeFunctions } = await loadModule();

        const promise = edgeFunctions.startAttempt("quiz-1");
        await vi.runAllTimersAsync();
        const res = await promise;

        expect(res.ok).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("throws after retry exhaustion and rewrites the error message via getUserFriendlyErrorMessage", async () => {
        // All 4 attempts (initial + 3 retries) fail with 503.
        mockFetchSequence(
            Array.from({ length: 4 }, () => ({
                body: {
                    ok: false,
                    error: { code: "SERVICE_UNAVAILABLE", message: "raw server string" },
                },
                status: 503,
            })),
        );
        const { edgeFunctions } = await loadModule();

        const caught = edgeFunctions.startAttempt("quiz-1").catch((e) => e);
        await vi.runAllTimersAsync();
        const err = await caught;

        expect(err.ok).toBe(false);
        // Should be rewritten to the friendly message, not the raw server string.
        expect(err.error?.message).not.toBe("raw server string");
        expect(err.error?.message).toMatch(/unavailable/i);
    });

    it("does NOT retry a 400 VALIDATION_ERROR", async () => {
        const fetchSpy = mockFetchSequence([
            {
                body: { ok: false, error: { code: "VALIDATION_ERROR", message: "bad input" } },
                status: 400,
            },
        ]);
        const { edgeFunctions } = await loadModule();

        const caught = edgeFunctions.startAttempt("quiz-1").catch((e) => e);
        await vi.runAllTimersAsync();
        await caught;

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});
