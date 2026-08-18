/**
 * Unit tests for handle content filtering.
 *
 * The false-negative cases (blocked terms getting through) matter, but the
 * false-positive cases matter more: wrongly rejecting a legitimate handle is
 * invisible to us and baffling to the player, so those are tested hardest.
 */

import { describe, it, expect } from "vitest";
import { containsBlockedContent } from "./handle-blocklist";
import { validateHandle, generateXboxStyleHandle } from "./handles";

describe("containsBlockedContent", () => {
    describe("blocks slurs anywhere in the handle", () => {
        const slurs = [
            "Nigger",
            "BigNiggaTiger",
            "Faggot99",
            "XxRetardxX",
            "CuntMaster",
            "PedoBear",
        ];

        for (const handle of slurs) {
            it(`blocks ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(true);
            });
        }
    });

    describe("blocks leetspeak evasion", () => {
        const evasions = ["n1gg3r", "N1GG4", "f4ggot", "5hit", "@sshole", "c0ck"];

        for (const handle of evasions) {
            it(`blocks ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(true);
            });
        }
    });

    describe("blocks profanity as a standalone word", () => {
        const profanity = ["Shit", "Shit42", "Fuck99", "Bitch", "Asshole7"];

        for (const handle of profanity) {
            it(`blocks ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(true);
            });
        }
    });

    describe("blocks profanity as a CamelCase segment", () => {
        const camel = ["BigAssTiger", "SuperShitLord", "TheFuckMaster"];

        for (const handle of camel) {
            it(`blocks ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(true);
            });
        }
    });

    describe("blocks reserved staff-impersonating names", () => {
        const reserved = ["Admin", "admin", "Moderator", "Support", "Official", "Admin42"];

        for (const handle of reserved) {
            it(`blocks ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(true);
            });
        }
    });

    // The Scunthorpe problem: these all contain a blocked substring but are
    // entirely legitimate handles. Regressions here are the expensive kind.
    describe("does NOT block legitimate handles containing blocked substrings", () => {
        const legitimate = [
            "Assassin",       // ass
            "Bassist",        // ass
            "Bassoon",        // ass
            "Class",          // ass
            "Compass",        // ass
            "Grass",          // ass
            "Cocktail",       // cock
            "Cockatoo",       // cock
            "Peacock",        // cock
            "Shuttlecock",    // cock
            "Analyst",        // anal
            "Analysis",       // anal
            "Titan",          // tit
            "Titanic",        // tit
            "Constitution",   // tit
            "Competitive",    // tit
            "Dickens",        // dick
            "Scunthorpe",     // the canonical case
            "Hoedown",        // hoe
            "Shoe",           // hoe
            "Cumberland",     // cum
            "Documentation",  // cum
            "Circumstance",   // cum
            "Massachusetts",  // ass
            "Assemble",       // ass
            "Passion",        // ass
            "Wanderer",       // wank-adjacent
            "Sixpence",       // sex-adjacent
        ];

        for (const handle of legitimate) {
            it(`accepts ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(false);
            });
        }
    });

    describe("accepts ordinary handles", () => {
        const ordinary = ["SwiftTiger42", "Dragon", "abc", "PlayerOne", "QuizWizard7"];

        for (const handle of ordinary) {
            it(`accepts ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(false);
            });
        }
    });

    it("handles empty input without throwing", () => {
        expect(containsBlockedContent("")).toBe(false);
    });
});

describe("validateHandle integration", () => {
    it("rejects a blocked handle that is otherwise well-formed", () => {
        const result = validateHandle("Nigger12");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/isn't available/i);
    });

    it("does not reveal which term matched", () => {
        const result = validateHandle("FuckFace");
        expect(result.valid).toBe(false);
        // The message must not echo the term back, or it becomes a probe oracle.
        expect(result.error?.toLowerCase()).not.toContain("fuck");
    });

    it("still accepts a clean handle", () => {
        expect(validateHandle("SwiftTiger42")).toEqual({ valid: true });
    });

    it("reports format errors before content errors", () => {
        // "ass" is too short anyway; the length message is the useful one.
        const result = validateHandle("ass");
        expect(result.valid).toBe(false);
    });

    // Every auto-generated handle must survive the filter, or signup breaks.
    it("never generates a handle the filter would block", () => {
        for (let i = 0; i < 2000; i++) {
            const handle = generateXboxStyleHandle();
            expect(
                containsBlockedContent(handle),
                `generated handle was blocked: ${handle}`
            ).toBe(false);
        }
    });
});
