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
| **Single source of truth** | `packages/contracts/scoring.ts` |
| Edge Functions (consumers) | `supabase/functions/submit-answer/`, `supabase/functions/finalize-attempt/` |
| Tests | Any test file importing from `packages/contracts/scoring.ts` |

## Guidelines

### Constants (All in `packages/contracts/scoring.ts`)

```typescript
QUESTION_TIME_LIMIT_MS = 16000
BONUS_WINDOW_MS       = 10000
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
| 0–2s | 5 |
| 2–4s | 4 |
| 4–6s | 3 |
| 6–8s | 2 |
| 8–10s | 1 |
| 10s+ | 0 |

- Clamp input: `clamped_time_ms = min(max(elapsed_ms, 0), BONUS_WINDOW_MS)`.
- Convert: `elapsed_seconds = clamped_time_ms / 1000`.
- Bonus is an integer — no rounding needed with step tiers.
- Final bonus ∈ `{0, 1, 2, 3, 4, 5}`.

### Timeout Behavior

If question expired (no answer within 16s):
- `is_correct = false`
- `base_points = 0`
- `bonus_points = 0`
- `elapsed_ms = 16000`

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

The scoring formula is implemented **once** in `packages/contracts/scoring.ts`. Edge Functions and tests **import and reuse** this implementation. No duplicated formulas.

## Anti-Patterns

- Edge Function implements its own bonus calculation instead of importing from contracts
- Different rounding logic in tests vs. production
- Magic numbers like `10000` or `5` scattered in code outside `scoring.ts`
- Bonus calculated as float without integer result
- Score validation missing or inconsistent
- `scoring_version` omitted from score records

## Examples

**Valid implementation:**
```typescript
// packages/contracts/scoring.ts
export function calculateBonus(elapsed_ms: number): number {
  const clamped = Math.min(Math.max(elapsed_ms, 0), BONUS_WINDOW_MS);
  const elapsedSeconds = clamped / 1000;

  if (elapsedSeconds < 2) return 5;
  else if (elapsedSeconds < 4) return 4;
  else if (elapsedSeconds < 6) return 3;
  else if (elapsedSeconds < 8) return 2;
  else if (elapsedSeconds < 10) return 1;
  else return 0;
}

// Edge Function — imports, does not re-implement
import { calculateBonus } from "packages/contracts/scoring.ts";
```
