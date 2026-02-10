---
name: Project Structure & Domain Boundaries
description: Enforce fixed monorepo structure, domain boundaries, file naming, and quiz publishing rules. Applies when creating files, components, features, or implementing the daily quiz publish operation.
---

# Project Structure & Domain Boundaries

## When This Skill Applies

- Creating new files, components, or modules
- Deciding where code should live in the monorepo
- Implementing or modifying the quiz publishing operation
- Naming files, functions, or event types
- Reviewing code placement

## Scope

The entire monorepo — especially the boundary between `apps/web/`, `supabase/`, and `packages/`.

## Guidelines

### Directory Structure (Non-Negotiable)

```
apps/web/src/           # Next.js app code
  app/                  # Route handlers (thin — data fetch + render only)
  components/           # Presentation-only (dumb UI, props in, events out)
  domains/              # Domain adapters (transform Edge Function responses → UI shapes)
    attempt/
    quiz/
    leaderboard/
    league/
    identity/
  lib/api/              # Typed API clients (generated from OpenAPI)

supabase/
  migrations/           # All SQL migrations
  functions/            # Edge Functions (all trusted business logic)
    start-attempt/
    submit-answer/
    finalize-attempt/
    publish-quiz/
    _shared/            # Shared utilities (logStructured, etc.)

packages/contracts/     # Source of truth for types shared between client and server
  openapi.yaml
  generated/api.ts
  scoring.ts
  errors.ts
```

### Separation of Concerns

| Layer | Responsibility | Must NOT |
|-------|---------------|----------|
| Route handlers (`app/`) | Data fetching + rendering | Contain scoring, timing, or state logic |
| Components (`components/`) | Presentation via props/events | Access DB or compute business logic |
| Domain adapters (`domains/`) | Transform API responses → UI shapes | Write to DB or contain business rules |
| Edge Functions (`functions/`) | All trusted business logic | Ship service role to client |
| Contracts (`packages/contracts/`) | Type definitions, scoring formula | Contain runtime logic beyond pure functions |

### File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Edge Functions | kebab-case folders/files | `supabase/functions/submit-answer/index.ts` |
| React components | PascalCase | `components/CountdownTimer.tsx` |
| Hooks | camelCase with `use` prefix | `useAttemptState.ts` |
| Domain modules | lowercase/kebab-case + `index.ts` | `domains/attempt/index.ts` |
| DB migrations | Supabase timestamped format | `20240115120000_add_attempt_constraint.sql` |
| Event types | PascalCase strings | `"AnswerSubmitted"`, `"ScoreComputed"` |

No exceptions — rename files that violate conventions immediately.

### Quiz Publishing Operation

**Schedule:** Cron job at **11:30 UTC daily**.

**Pre-publish validation (hard fail):**
- Quiz has exactly 10 questions
- Each question has exactly 4 choices
- Each question has 1–5 tags
- Correct answers exist in private table for all 10 questions
- If validation fails → log error, alert, leave as `draft`. Never publish invalid quiz.

**Publish operation:**
1. Find draft quiz where `release_at_utc <= now()` and `status = 'draft'`.
2. Validate (see above).
3. If valid: set `status = 'published'`.
4. Write `QuizPublished` event to `outbox_events`.

**Idempotency:** Running publish twice yields same live quiz. Check `status = 'published'` before publishing.

**Current quiz selection:**
```sql
SELECT * FROM quizzes
WHERE status = 'published' AND release_at_utc <= now()
ORDER BY release_at_utc DESC LIMIT 1
```

**Failure mode:** No valid quiz → `503 QUIZ_NOT_AVAILABLE` + `Retry-After` header + "Come Back Tomorrow" client screen.

**Testability:** Publish must be testable locally (not depend on production cron). Create test function callable manually.

## Anti-Patterns

- Scoring calculation logic in `apps/web/src/app/play/page.tsx`
- Ad-hoc utility file at `apps/web/src/utils/attempt.ts` (should be in `domains/attempt/`)
- Direct database access from `apps/web/src/lib/db.ts`
- camelCase Edge Function folder: `supabase/functions/submitAnswer/`
- kebab-case component: `components/countdown-timer.tsx`
- Business logic in route handlers or components
- Publishing quiz without validation
- Non-idempotent publish (creates duplicates on re-run)
- Depending on UI to trigger publish

## Examples

**Valid code placement:**
```
apps/web/src/app/play/page.tsx          → thin route, calls domain adapter
apps/web/src/components/CountdownTimer.tsx → PascalCase, presentation only
apps/web/src/domains/attempt/useAttempt.ts → camelCase hook
apps/web/src/lib/api/attempt.ts         → typed client for /api/attempt/start
supabase/functions/start-attempt/index.ts → kebab-case Edge Function
packages/contracts/scoring.ts           → scoring formula and types
```
