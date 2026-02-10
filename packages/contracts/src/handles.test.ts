/**
 * Unit tests for handle generation and validation.
 */

import { describe, it, expect } from "vitest";
import {
    generateXboxStyleHandle,
    validateHandle,
    canonicalizeHandle,
} from "./handles.js";

describe("validateHandle", () => {
    describe("valid handles", () => {
        it("accepts 3-character handle", () => {
            expect(validateHandle("abc")).toEqual({ valid: true });
        });

        it("accepts 20-character handle", () => {
            expect(validateHandle("a".repeat(20))).toEqual({ valid: true });
        });

        it("accepts alphanumeric handle starting with letter", () => {
            expect(validateHandle("SwiftTiger42")).toEqual({ valid: true });
        });

        it("accepts single-word handle", () => {
            expect(validateHandle("Dragon")).toEqual({ valid: true });
        });
    });

    describe("too short", () => {
        it("rejects 1-character handle", () => {
            const result = validateHandle("a");
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/at least 3/i);
        });

        it("rejects 2-character handle", () => {
            const result = validateHandle("ab");
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/at least 3/i);
        });

        it("rejects empty string", () => {
            const result = validateHandle("");
            expect(result.valid).toBe(false);
        });
    });

    describe("too long", () => {
        it("rejects 21-character handle", () => {
            const result = validateHandle("a".repeat(21));
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/20 characters/i);
        });
    });

    describe("invalid characters", () => {
        it("rejects handle starting with number", () => {
            const result = validateHandle("1Tiger");
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/start with a letter/i);
        });

        it("rejects handle with spaces", () => {
            const result = validateHandle("Swift Tiger");
            expect(result.valid).toBe(false);
        });

        it("rejects handle with special characters", () => {
            const result = validateHandle("Swift_Tiger!");
            expect(result.valid).toBe(false);
        });

        it("rejects handle with underscores", () => {
            const result = validateHandle("swift_tiger");
            expect(result.valid).toBe(false);
        });
    });

    describe("edge cases", () => {
        it("rejects null-like input", () => {
            const result = validateHandle(null as unknown as string);
            expect(result.valid).toBe(false);
        });

        it("rejects undefined input", () => {
            const result = validateHandle(undefined as unknown as string);
            expect(result.valid).toBe(false);
        });

        it("trims whitespace before validating", () => {
            expect(validateHandle("  abc  ")).toEqual({ valid: true });
        });

        it("rejects whitespace-only input that trims to too short", () => {
            const result = validateHandle("   a   ");
            expect(result.valid).toBe(false);
        });
    });
});

describe("canonicalizeHandle", () => {
    it("lowercases handle", () => {
        expect(canonicalizeHandle("SwiftTiger42")).toBe("swifttiger42");
    });

    it("trims whitespace", () => {
        expect(canonicalizeHandle("  SwiftTiger42  ")).toBe("swifttiger42");
    });

    it("handles already lowercase", () => {
        expect(canonicalizeHandle("dragon")).toBe("dragon");
    });
});

describe("generateXboxStyleHandle", () => {
    it("returns a string", () => {
        const handle = generateXboxStyleHandle();
        expect(typeof handle).toBe("string");
    });

    it("matches expected pattern (letters followed by 2-digit number)", () => {
        const handle = generateXboxStyleHandle();
        expect(handle).toMatch(/^[A-Z][a-zA-Z]+[A-Z][a-zA-Z]+\d{2}$/);
    });

    it("generates handles within valid length range", () => {
        // Run multiple times to catch edge cases
        for (let i = 0; i < 50; i++) {
            const handle = generateXboxStyleHandle();
            expect(handle.length).toBeGreaterThanOrEqual(5); // shortest: "Bold" + "Fox" + "00" = but adj+noun minimum
            expect(handle.length).toBeLessThanOrEqual(20);
        }
    });

    it("passes its own validation", () => {
        for (let i = 0; i < 20; i++) {
            const handle = generateXboxStyleHandle();
            const result = validateHandle(handle);
            expect(result.valid).toBe(true);
        }
    });
});
