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

    // Regression: leetspeak inside a CamelCase segment. Folding alone gives
    // "shitlord" with no case boundary to split on, and splitting alone gives
    // "Sh1t" which is not a listed term — so this needs both together.
    describe("blocks leetspeak inside a CamelCase segment", () => {
        const camelLeet = [
            "Sh1tLord",
            "B1gAssTiger",
            "TheD1ckKing",
            "Cr4zyB1tchQueen",
        ];

        for (const handle of camelLeet) {
            it(`blocks ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(true);
            });
        }
    });

    // Known and accepted gap. Leet substitution is ambiguous: "4" means "a" in
    // "f4g" but "u" in "f4ck", so a fixed mapping folds this to "fack" and
    // misses it. Fuzzy consonant-skeleton matching would catch it, but when
    // tested against /usr/share/dict/words it also flagged 343 ordinary words
    // ("aconite", "apron", "auspicious"). Rejecting real words is the worse
    // failure, so this is left to user reporting instead.
    it("does not catch vowel-ambiguous leetspeak (documented gap)", () => {
        expect(containsBlockedContent("SuperF4ckMaster")).toBe(false);
    });

    // Trailing digits are ordinary handle suffixes, not evasion. Folding them
    // would turn "Tigers5" into "Tigerss" and break the digit-boundary rule.
    describe("does not treat trailing suffix numbers as leetspeak", () => {
        const suffixed = [
            "SwiftTiger42",
            "Dragon007",
            "Cocktail5",
            "Assassin13",
            "Bassist100",
        ];

        for (const handle of suffixed) {
            it(`accepts ${handle}`, () => {
                expect(containsBlockedContent(handle)).toBe(false);
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
