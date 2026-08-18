---
name: Scoring Formula & Bonus Calculation
description: Implement and enforce the single-source scoring formula with step-based bonus tiers, rounding rules, and score invariants. Applies when writing scoring logic, bonus calculations, or validating scores.
---

# Scoring Formula & Bonus Calculation

## When This Skill Applies

- Implementing or modifying any scoring logic
- Computing bonus points from elapsed time
- Validating scores (unit tests, integration tests)
- Displaying scores in the UI (scores are read-only on client; computed on server)
- Adding new scoring-related constants or changing existing ones

## Scope

| Area | Files / Paths |
|------|--------------|
| **Single source of truth** | `packages/contracts/src/scoring.ts` |
| Edge Functions (consumers) | `supabase/functions/submit-answer/`, `supabase/functions/finalize-attempt/` |
| Tests | Any test file importing from `packages/contracts/src/scoring.ts` |

## Guidelines

### Constants (All in `packages/contracts/src/scoring.ts`)

```typescript
QUESTION_TIME_LIMIT_MS = 12000
BONUS_WINDOW_MS       = 11000
BASE_POINTS_CORRECT   = 5
BASE_POINTS_INCORRECT = 0
MAX_BONUS_POINTS      = 5
SCORING_VERSION       = 1
```

Never scatter magic numbers. Import from contracts only.

### Base Points

- `base_points = 5` if `is_correct === true`, else `0`.
- Integer values only.

### Bonus Points (Step-Based Tiers)

| Elapsed Time | Bonus |
|-------------|-------|
| 0–3s | 5 |
| 3–5s | 4 |
| 5–7s | 3 |
| 7–9s | 2 |
| 9–11s | 1 |
| 11s+ | 0 |

- Clamp input: `clamped_time_ms = min(max(elapsed_ms, 0), BONUS_WINDOW_MS)`.
- Convert: `elapsed_seconds = clamped_time_ms / 1000`.
- Bonus is an integer — no rounding needed with step tiers.
- Final bonus ∈ `{0, 1, 2, 3, 4, 5}`.

### Timeout Behavior

If question expired (no answer within 12s):
- `is_correct = false`
- `base_points = 0`
- `bonus_points = 0`
- `elapsed_ms = 12000`

### Per-Question Score

- `question_score = base_points + bonus_points`
- Store both values separately in `attempt_answers` table.
- `total_score = sum(all question_scores)`

### Invariants

- Max possible score: `10 × (5 + 5) = 100`. Reject any calculation exceeding this.
- Scoring is **deterministic**: same inputs → same outputs, always.
- Include `scoring_version` in all score calculations for future migration support.

**Why single-source:** If the formula is duplicated in Edge Functions, tests, and client, drift is inevitable. One implementation in contracts, imported everywhere, guarantees consistency.

### Implementation Rule

The scoring formula has **two** implementations that must be kept identical:
`packages/contracts/src/scoring.ts` (constants in `packages/contracts/src/constants.ts`) and
`supabase/functions/_shared/scoring.ts`, a hand-maintained Deno copy that exists because edge
functions cannot import from the Node workspace package.

**Change one, change the other.** Nothing enforces agreement today.

Note also that `packages/contracts/src/scoring.ts` currently has **zero runtime importers** —
only its own test imports it. The scoring that actually runs in production is the Deno copy.

## Anti-Patterns

- Edge Function implements its own bonus calculation instead of importing from contracts
- Different rounding logic in tests vs. production
- Magic numbers like `11000` or `5` scattered in code outside `scoring.ts`
- Bonus calculated as float without integer result
- Score validation missing or inconsistent
- `scoring_version` omitted from score records

## Examples

**Valid implementation:**
```typescript
// packages/contracts/src/scoring.ts
export function calculateBonus(elapsed_ms: number): number {
  const clamped = Math.min(Math.max(elapsed_ms, 0), BONUS_WINDOW_MS);
  const elapsedSeconds = clamped / 1000;

  if (elapsedSeconds < 3) return 5;
  else if (elapsedSeconds < 5) return 4;
  else if (elapsedSeconds < 7) return 3;
  else if (elapsedSeconds < 9) return 2;
  else if (elapsedSeconds < 11) return 1;
  else return 0;
}

// Edge Function — imports, does not re-implement
import { calculateBonus } from "packages/contracts/src/scoring.ts";
```
