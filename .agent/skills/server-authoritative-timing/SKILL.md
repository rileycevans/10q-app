---
name: Server-Authoritative Timing & Anti-Cheat
description: Enforce server-only timestamps for question timing, answer submission, scoring, and resume logic. Applies when implementing anything involving elapsed time, countdowns, answer expiry, or attempt resume.
---

# Server-Authoritative Timing & Anti-Cheat

## When This Skill Applies

- Implementing question timing or countdown UI
- Building answer submission Edge Functions
- Implementing attempt resume logic
- Any code that computes elapsed time for scoring
- Any code that determines whether a question has expired

## Scope

| Area | Files / Paths |
|------|--------------|
| Edge Functions | `supabase/functions/submit-answer/`, `supabase/functions/start-attempt/` |
| Migrations | `supabase/migrations/*.sql` |
| Contracts | `packages/contracts/scoring.ts` |
| Client timer UI | `apps/web/src/components/CountdownTimer.tsx`, `apps/web/src/domains/attempt/` |

## Guidelines

### Canonical Timestamps (All Server `now()`)

- Store `question_presented_at` TIMESTAMPTZ in `attempts` table — set to server `now()` when question starts.
- Store `current_question_expires_at` TIMESTAMPTZ = `question_presented_at + 16 seconds`.
- On answer submission, store `answered_at` TIMESTAMPTZ = server `now()`.
- Compute `elapsed_ms = clamp(answered_at - question_presented_at, 0, 16000)`.

**Why server-only:** Client clocks can be manipulated. In a competitive quiz game, even milliseconds of bonus depend on honest timing. Server `now()` is the only trustworthy source.

### Client Input Restrictions

The client may send **only**:
- `attempt_id`
- `question_id`
- `selected_choice`
- Optional `seen_at` (for telemetry only — never used for scoring)

The server **ignores** all client-provided timing data and computes everything from stored `question_presented_at` + server `now()`.

### Resume Behavior

- On resume, server computes remaining time: `remaining_ms = max(0, current_question_expires_at - now())`.
- If `now() - question_presented_at >= 16000`, the question is expired:
  - Mark as `answer_kind = 'timeout'` with `selected_answer_id = NULL`.
  - Set `is_correct = false`, `base_points = 0`, `bonus_points = 0`.
  - Auto-advance to next question (increment `current_index`).
- **Refresh/resume does NOT pause time.** Time continues counting on the server regardless of client state.

### Auto-Advance Semantics

- UI may show countdown and auto-advance visually, but authoritative progression is **server-driven**.
- Server increments `current_index` after writing `attempt_answers` row.
- Client must poll or use server-sent events to detect question changes.

### Database Constraints

- `attempts.current_question_expires_at` must equal `current_question_started_at + INTERVAL '16 seconds'` — enforce via CHECK constraint or trigger.
- `attempt_answers.time_ms` must be `BETWEEN 0 AND 16000`.

## Anti-Patterns

- Edge Function accepts `{ attempt_id, question_id, selected_choice, client_time_ms }` and **uses** `client_time_ms` for scoring
- Client sends countdown timer value that server trusts
- Server uses client's "time remaining" calculation
- Resume pauses the timer
- `elapsed_ms` computed on the client and sent to the server
- No DB constraint on `time_ms` range

## Examples

**Valid submission flow:**
```
1. Edge Function receives: { attempt_id, question_id, selected_choice }
2. Server reads attempts.current_question_started_at from DB
3. Server computes: elapsed_ms = clamp(now() - current_question_started_at, 0, 16000)
4. Server writes attempt_answers with server-computed time_ms
5. Server increments attempts.current_index
```

**Valid resume flow:**
```
1. Client reconnects after network drop
2. Server computes: remaining_ms = max(0, expires_at - now())
3. If remaining_ms == 0: auto-mark timeout, advance to next question
4. If remaining_ms > 0: return remaining_ms to client for UI countdown
5. Time was never paused — server clock continued
```
