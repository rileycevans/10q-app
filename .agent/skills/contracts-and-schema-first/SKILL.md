---
name: Contracts & Schema-First Development
description: Update contracts, DB invariants, and outbox events before implementing features. Applies when starting any new feature, modifying schema, or working with leaderboards and domain events.
---

# Contracts & Schema-First Development

## When This Skill Applies

- Starting any new feature or modifying existing behavior
- Creating or changing database schema
- Working with leaderboard queries, stats, or rollups
- Writing domain events or event-sourced data flows
- Generating or updating API types

## Scope

| Area | Files / Paths |
|------|--------------|
| OpenAPI contracts | `packages/contracts/openapi.yaml` |
| Generated types | `packages/contracts/generated/api.ts` |
| Generated client | `apps/web/src/lib/api/client.ts` |
| Hand-written types | `packages/contracts/scoring.ts`, `packages/contracts/errors.ts`, event payloads |
| Migrations | `supabase/migrations/*.sql` |
| Outbox events | `outbox_events` table |

## Guidelines

### Implementation Order

Every feature follows this sequence — no exceptions:

1. **Update contracts** (`packages/contracts/`) — API shapes, scoring inputs/outputs, events.
2. **Create/modify SQL migration** that enforces invariants in Postgres.
3. **Then** implement Edge Function logic and UI wiring.

**Why this order:** Contracts define the interface. Schema enforces the invariants. Code is the last step because it depends on both. Reversing this order produces drift between intent and implementation.

### Contract Format

- **OpenAPI** (`packages/contracts/openapi.yaml`) is the single source of truth for Edge Function contracts.
- **Generated types** from OpenAPI: `packages/contracts/generated/api.ts`.
- **Generated typed client** from OpenAPI: `apps/web/src/lib/api/client.ts`.
- **Hand-written types** for: domain models, scoring rules, event payloads.

### Database-Enforced Invariants

- Prefer SQL constraints (`UNIQUE`, `CHECK`, `FOREIGN KEY`) over application code.
- Use triggers for complex invariants that cannot be expressed as simple constraints.
- If an invariant cannot be encoded in SQL, enforce in Edge Functions — **never in client**.
- Every migration includes constraints, not just table definitions.

### Evented Architecture & Immutable Facts

**Immutability rules:**
- `daily_scores` is append-only (insert once when attempt finalized; never update).
- `attempt_answers` is append-only (no edits after submission).
- Use DB constraints to prevent updates to finalized data.

**Domain events** — write to `outbox_events` table for:
- `QuizPublished`, `AttemptStarted`, `AnswerSubmitted`, `AttemptCompleted`, `ScoreComputed`

Events must include all data needed to rebuild state. They are append-only and immutable.

**Outbox schema:**
```sql
CREATE TABLE IF NOT EXISTS public.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_version INT NOT NULL DEFAULT 1,
  idempotency_key TEXT NULL,
  actor_user_id UUID NULL,
  payload JSONB NOT NULL,
  trace_id TEXT NULL,
  published_at TIMESTAMPTZ NULL
);
```

### Leaderboard Derivation

- Derive leaderboards (Today/7d/30d/365d) from immutable facts in `daily_scores`.
- Use materialized views or rollup tables for performance.
- Leaderboards must be rebuildable from `daily_scores` and events.
- Rollup rebuilds must produce identical results every time (deterministic queries).

### Idempotency

- `publish-quiz` safe to run twice (check status before publishing).
- `submit-answer` idempotent per `(attempt_id, question_id)`.
- Rollup rebuilds produce identical results.

## Anti-Patterns

- Implementing Edge Function without updating OpenAPI
- Manually writing TypeScript types instead of generating from OpenAPI
- Adding migration without constraints
- Relying on client-side validation to prevent invalid data
- `UPDATE daily_scores SET score = score + 5 WHERE ...` (mutating existing rows)
- Leaderboard computed from mutable `attempts` table instead of `daily_scores`
- Events written without required fields
- Non-idempotent operations that fail on retry

## Examples

**Valid workflow:**
```
1. Update packages/contracts/openapi.yaml with /api/attempt/start request/response
2. Run codegen → packages/contracts/generated/api.ts + apps/web/src/lib/api/client.ts
3. Update packages/contracts/scoring.ts with bonus calculation types
4. Add migration: ALTER TABLE attempts ADD CONSTRAINT one_attempt_per_quiz UNIQUE (player_id, quiz_id)
5. Implement Edge Function that respects the constraint
6. Wire UI to use generated typed client
```

**Valid event write:**
```sql
INSERT INTO outbox_events (
  aggregate_type, aggregate_id, event_type, event_version,
  actor_user_id, payload, trace_id
) VALUES (
  'attempt', $attempt_id, 'AttemptCompleted', 1,
  $player_id, '{"score": 85, "correct_count": 9}'::jsonb, $request_id
)
```
