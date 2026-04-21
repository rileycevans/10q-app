/**
 * Unit tests for error-handling utilities.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserFriendlyErrorMessage, withRetry } from "./error-handling";

describe("getUserFriendlyErrorMessage", () => {
    describe("error code mapping", () => {
        it("maps NOT_AUTHORIZED to sign-in message", () => {
            const msg = getUserFriendlyErrorMessage({ code: "NOT_AUTHORIZED" });
            expect(msg).toBe("Please sign in to continue");
        });

        it("maps QUIZ_NOT_FOUND", () => {
            const msg = getUserFriendlyErrorMessage({ code: "QUIZ_NOT_FOUND" });
            expect(msg).toMatch(/quiz not found/i);
        });

        it("maps ATTEMPT_ALREADY_COMPLETED", () => {
            const msg = getUserFriendlyErrorMessage({
                code: "ATTEMPT_ALREADY_COMPLETED",
            });
            expect(msg).toMatch(/already completed/i);
        });

        it("maps ATTEMPT_NOT_FOUND", () => {
            const msg = getUserFriendlyErrorMessage({ code: "ATTEMPT_NOT_FOUND" });
            expect(msg).toMatch(/attempt not found/i);
        });

        it("maps VALIDATION_ERROR", () => {
            const msg = getUserFriendlyErrorMessage({ code: "VALIDATION_ERROR" });
            expect(msg).toMatch(/invalid input/i);
        });

        it("maps SERVICE_UNAVAILABLE", () => {
            const msg = getUserFriendlyErrorMessage({ code: "SERVICE_UNAVAILABLE" });
            expect(msg).toMatch(/temporarily unavailable/i);
        });

        it("maps QUESTION_NOT_FOUND", () => {
            const msg = getUserFriendlyErrorMessage({ code: "QUESTION_NOT_FOUND" });
            expect(msg).toMatch(/question not found/i);
        });

        it("maps INVALID_STATE_TRANSITION", () => {
            const msg = getUserFriendlyErrorMessage({
                code: "INVALID_STATE_TRANSITION",
            });
            expect(msg).toMatch(/refresh/i);
        });
    });

    describe("status code fallback", () => {
        it("maps 401 to sign-in message", () => {
            const msg = getUserFriendlyErrorMessage(undefined, 401);
            expect(msg).toMatch(/sign in/i);
        });

        it("maps 403 to permission message", () => {
            const msg = getUserFriendlyErrorMessage(undefined, 403);
            expect(msg).toMatch(/permission/i);
        });

        it("maps 404 to not found", () => {
            const msg = getUserFriendlyErrorMessage(undefined, 404);
            expect(msg).toMatch(/not found/i);
        });

        it("maps 429 to rate limit", () => {
            const msg = getUserFriendlyErrorMessage(undefined, 429);
            expect(msg).toMatch(/too many requests/i);
        });

        it("maps 500 to server error", () => {
            const msg = getUserFriendlyErrorMessage(undefined, 500);
            expect(msg).toMatch(/server error/i);
        });

        it("maps 503 to unavailable", () => {
            const msg = getUserFriendlyErrorMessage(undefined, 503);
            expect(msg).toMatch(/unavailable/i);
        });
    });

    describe("priority order", () => {
        it("prefers error code over status code", () => {
            const msg = getUserFriendlyErrorMessage(
                { code: "QUIZ_NOT_FOUND" },
                500
            );
            expect(msg).toMatch(/quiz not found/i);
        });

        it("falls back to error.message if code is unknown", () => {
            const msg = getUserFriendlyErrorMessage({
                code: "UNKNOWN_CODE",
                message: "Something specific happened",
            });
            expect(msg).toBe("Something specific happened");
        });

        it("falls back to status code if no error code match", () => {
            const msg = getUserFriendlyErrorMessage(
                { code: "UNKNOWN_CODE" },
                404
            );
            expect(msg).toMatch(/not found/i);
        });
    });

    describe("default fallback", () => {
        it("returns default message with no inputs", () => {
            const msg = getUserFriendlyErrorMessage();
            expect(msg).toMatch(/unexpected error/i);
        });

        it("returns default message with unknown code and no status", () => {
            const msg = getUserFriendlyErrorMessage({ code: "TOTALLY_NEW_ERROR" });
            expect(msg).toMatch(/unexpected error/i);
        });
    });
});

describe("withRetry", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function runAll<T>(p: Promise<T>): Promise<T> {
        // Attach the catch handler before advancing timers so the rejection
        // is consumed synchronously and doesn't leak as an unhandled rejection.
        const settled = p.then(
            (v) => ({ ok: true as const, v }),
            (e) => ({ ok: false as const, e }),
        );
        await vi.runAllTimersAsync();
        const result = await settled;
        if (result.ok) return result.v;
        throw result.e;
    }

    it("returns immediately on success without retrying", async () => {
        const fn = vi.fn().mockResolvedValue("ok");
        const result = await withRetry(fn);
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on a retryable status code and eventually succeeds", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ status: 503 })
            .mockRejectedValueOnce({ status: 502 })
            .mockResolvedValueOnce("ok");

        const result = await runAll(withRetry(fn, { initialDelayMs: 10, maxDelayMs: 50 }));
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("retries on a retryable error code (SERVICE_UNAVAILABLE)", async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ status: 500, error: { code: "SERVICE_UNAVAILABLE" } })
            .mockResolvedValueOnce("ok");
        const result = await runAll(withRetry(fn, { initialDelayMs: 10 }));
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("retries on a network error (no status field at all)", async () => {
        // Errors with no `.status` are treated as network/unknown -> retryable.
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce("ok");
        const result = await runAll(withRetry(fn, { initialDelayMs: 10 }));
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on a 400 validation error", async () => {
        const err = { status: 400, error: { code: "VALIDATION_ERROR" } };
        const fn = vi.fn().mockRejectedValue(err);
        await expect(withRetry(fn, { initialDelayMs: 10 })).rejects.toEqual(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on a 401 (auth failures are terminal)", async () => {
        const err = { status: 401, error: { code: "NOT_AUTHORIZED" } };
        const fn = vi.fn().mockRejectedValue(err);
        await expect(withRetry(fn, { initialDelayMs: 10 })).rejects.toEqual(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("throws the last error after exhausting retries", async () => {
        const err = { status: 503 };
        const fn = vi.fn().mockRejectedValue(err);
        await expect(
            runAll(
                withRetry(fn, { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50 }),
            ),
        ).rejects.toEqual(err);
        // maxRetries=2 means 1 initial + 2 retries = 3 total attempts
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("uses exponential backoff capped by maxDelayMs", async () => {
        vi.useRealTimers(); // Real timers needed to inspect actual wait lengths
        const timestamps: number[] = [];
        const err = { status: 503 };
        const fn = vi.fn().mockImplementation(() => {
            timestamps.push(Date.now());
            return Promise.reject(err);
        });

        await expect(
            withRetry(fn, { maxRetries: 3, initialDelayMs: 20, maxDelayMs: 60 }),
        ).rejects.toEqual(err);

        // 4 attempts (1 + 3 retries). Gaps should be ~20, ~40, ~60 (capped).
        // With ±20% jitter: gaps fall in [16, 24], [32, 48], [48, 72] (cap applied before jitter).
        const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        expect(gaps).toHaveLength(3);
        expect(gaps[0]).toBeGreaterThanOrEqual(10);
        expect(gaps[1]).toBeGreaterThan(gaps[0] * 0.9);
        expect(gaps[2]).toBeLessThan(gaps[1] * 2);
    });

    it("respects custom retryableStatusCodes (will not retry unlisted codes)", async () => {
        const err = { status: 503 };
        const fn = vi.fn().mockRejectedValue(err);
        // Only 500 is retryable per this config, so 503 should surface immediately.
        await expect(
            withRetry(fn, { retryableStatusCodes: [500], initialDelayMs: 10 }),
        ).rejects.toEqual(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
