---
name: Attempt State Machine & Lifecycle
description: Enforce the explicit attempt state machine with DB constraints, valid transitions, idempotency keys, and immutability after finalization. Applies when implementing attempt creation, answer submission, finalization, or resume logic.
---

# Attempt State Machine & Lifecycle

## When This Skill Applies

- Creating or starting an attempt
- Submitting an answer
- Finalizing an attempt
- Resuming an in-progress attempt
- Writing migrations for `attempts` or `attempt_answers` tables
- Testing attempt-related flows

## Scope

| Area | Files / Paths |
|------|--------------|
| Edge Functions | `supabase/functions/start-attempt/`, `supabase/functions/submit-answer/`, `supabase/functions/finalize-attempt/` |
| Migrations | `supabase/migrations/*.sql` (attempts, attempt_answers tables) |
| Contracts | `packages/contracts/` (attempt types, error codes) |
| Domain adapter | `apps/web/src/domains/attempt/` |

## Guidelines

### State Definitions

Three states stored in `attempts` table:

| State | `finalized_at` | `current_index` |
|-------|----------------|-----------------|
| `NOT_STARTED` | NULL | 1 |
| `IN_PROGRESS` | NULL | 2–10 |
| `COMPLETED` | NOT NULL | 11 |

- `finalized_at` TIMESTAMPTZ distinguishes completed vs. active.
- `current_index` distinguishes not-started vs. in-progress.

### State Transition Table

| From | To | Trigger |
|------|----|---------|
| `NOT_STARTED` | `IN_PROGRESS` | First answer submitted |
| `IN_PROGRESS` | `IN_PROGRESS` | Idempotent answer (same question) |
| `IN_PROGRESS` | `COMPLETED` | All 10 questions answered or expired |

**Forbidden transitions:**
- `COMPLETED → *` — any operation on a finalized attempt is rejected.
- Any transition not listed above.

### Transition Enforcement

- Enforce via **database constraints or triggers** (not application code alone).
- Edge Functions reject invalid transitions with **stable error codes**:
  - `ATTEMPT_ALREADY_COMPLETED` — operation on finalized attempt
  - `INVALID_STATE_TRANSITION` — attempted invalid transition

**Why DB-level enforcement:** Application code can have bugs. DB constraints are the last line of defense for data integrity — they cannot be bypassed by buggy code paths.

### Idempotency

- `PRIMARY KEY (attempt_id, question_id)` on `attempt_answers` prevents duplicate submissions.
- Submitting the same answer twice returns the same result (idempotent).

### One Attempt Per Day

- `UNIQUE(player_id, quiz_id)` constraint on `attempts` table.
- Edge Function checks and returns `ATTEMPT_ALREADY_EXISTS` if violated.

### Cross-Quiz Rule

- Attempt is bound to `quiz_id` at start.
- **Attempt remains playable even after next day publishes.** A user can complete yesterday's attempt even if today's quiz is live.

### Resume Persistence

Store for resuming:
- `current_index`
- `current_question_started_at`
- `current_question_expires_at`

Per-question answers in `attempt_answers` table. Resume reads from DB and computes remaining time server-side.

### Immutability After Finalization

Once `finalized_at` is set:
- Attempt is **immutable** — no updates to `attempts` or `attempt_answers`.
- Enforce via database trigger or application logic.

## Anti-Patterns

- Submitting an answer to a `COMPLETED` attempt without returning `ATTEMPT_ALREADY_COMPLETED`
- Updating a finalized attempt's data
- Creating a second attempt for the same quiz without returning `ATTEMPT_ALREADY_EXISTS`
- Resume that pauses the timer (time continues on server)
- Enforcing state transitions only in application code with no DB constraint
- Using ad-hoc string errors instead of stable error codes

## Examples

**Valid transitions:**
```
Start attempt:  NOT_STARTED → IN_PROGRESS (current_index: 1 → 2)
Submit answer:  IN_PROGRESS → IN_PROGRESS (idempotent, same question)
Finalize:       IN_PROGRESS → COMPLETED   (set finalized_at, current_index = 11)
Resume:         read from DB, compute remaining time, continue IN_PROGRESS
```

**Invalid transitions (must be rejected):**
```
Submit to COMPLETED attempt → return ATTEMPT_ALREADY_COMPLETED
Update finalized attempt    → rejected by DB constraint
Create 2nd attempt for quiz → return ATTEMPT_ALREADY_EXISTS
Resume that pauses timer    → time continues on server, never paused
```
