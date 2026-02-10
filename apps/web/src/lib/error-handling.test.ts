/**
 * Unit tests for error-handling utilities.
 */

import { describe, it, expect } from "vitest";
import { getUserFriendlyErrorMessage } from "./error-handling";

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
