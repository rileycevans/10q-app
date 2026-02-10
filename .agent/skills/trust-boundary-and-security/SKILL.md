---
name: Trust Boundary & Security Gate
description: Enforce strict client/server trust boundaries, RLS policies, migration requirements, and shipping criteria. Applies when implementing data access, API endpoints, schema changes, or preparing code for merge.
---

# Trust Boundary & Security Gate

## When This Skill Applies

- Implementing any client-side data access or API call
- Creating or modifying Edge Functions (Supabase Deno runtime)
- Changing database schema, RLS policies, or access patterns
- Preparing any change for merge (the "enforcement gate" — every PR must satisfy this)
- Reviewing code that touches `attempts`, `attempt_answers`, `daily_scores`, or `private.*` tables

## Scope

| Area | Files / Paths |
|------|--------------|
| Client reads | `apps/web/src/**` |
| Edge Functions | `supabase/functions/*/index.ts` |
| Shared utilities | `supabase/functions/_shared/` |
| RLS policies | `supabase/migrations/*.sql` |
| Contracts | `packages/contracts/` |

## Guidelines

### Client Trust Boundary

The client is treated as hostile. It cannot be trusted with sensitive data or business logic.

**Reads:**
- Client may `SELECT` only from safe public read models (e.g. `public.quiz_play_view`).
- Public views include question text, choices, tags, order — never correct answers or scoring logic.

**Writes:**
- All gameplay state changes go through Edge Functions.
- Client never writes directly to `attempts`, `attempt_answers`, or `daily_scores`.

**Prohibitions** (the client must **never**):
- Fetch correct answers, directly or indirectly
- Compute score or bonus points
- Act as timing authority
- Bypass Edge Functions for writes

### Correct Answer Protection

- Store correct answers in a locked table (`private.correct_answers`) with RLS deny-all.
- Use `public.quiz_play_view` for gameplay — no correct-answer field.
- Edge Functions use **service role** to read private answers and compute results.

### RLS Policy Requirements

- Deny all access to private tables from authenticated users.
- Grant `SELECT` on public views only.
- Edge Functions use service role to bypass RLS for trusted operations.
- Test RLS policies against local Supabase stack (seed + migrations).
- Test that authenticated users cannot read private tables.
- Test that league members can only see their league's data.
- Verify service role bypass works for Edge Functions.

### Edge Function Standards

- **Runtime**: Deno (Supabase standard).
- **Auth**: Verify JWT on every function (except public read endpoints).
- **Service role**: Only inside Edge Functions; never ship to client.
- **CORS**: Standardized across all functions.
- **Response format** (uniform):
  - Success: `{ ok: true, data: T, request_id: string }`
  - Error: `{ ok: false, error: { code: string, message: string, details?: unknown }, request_id: string }`
- **Request ID**: Attach `request_id` to all requests, log structured JSON, return in responses.
- All Edge Functions compute time/scoring server-side (never trust client).

### Shipping Gate (Every Change Must Include)

1. **SQL migration** for any schema change (`supabase/migrations/`), including constraints — not just table definitions.
2. **RLS policy updates** if access patterns change.
3. **Tests that prove invariants are enforced:**
   - Vitest for unit/integration tests (domain logic, scoring edge cases, state machine, security boundaries).
   - Playwright for E2E tests (gameplay flows, happy-path).
   - Integration tests hitting Edge Functions: start → submit → finalize → fetch results.
4. Test migrations on clean database to verify constraints work.
5. All tests pass before merging.

**Why this gate exists:** AI-generated code ships faster than human review can catch regressions. The gate ensures invariants are machine-verified, not just visually inspected.

## Anti-Patterns

- Client queries `SELECT * FROM questions` (includes `correct_answer` column)
- Client computes score: `if (selected === correct) score += 5`
- Client writes directly: `INSERT INTO attempt_answers ...`
- Edge Function trusts client-provided `time_ms` without server validation
- Edge Function returns inconsistent response format
- Edge Function uses client credentials instead of service role
- Shipping code without migration, RLS updates, or tests
- Relying on manual testing only
- Adding feature code without migration
- Skipping RLS policy updates

## Examples

**Valid pattern:**
```
Client queries: SELECT * FROM public.quiz_play_view WHERE quiz_id = $1
Client calls:   POST /api/attempt/answer (Edge Function, with JWT)
Edge Function:  verifies JWT → generates request_id → logs structured JSON
                reads private.correct_answers using service role
                computes score server-side → writes attempt_answers
                returns { ok: true, data: {...}, request_id: "..." }
```

**Valid shipping process:**
```
1. Add migration: ALTER TABLE attempts ADD CONSTRAINT ...
2. Update RLS:    CREATE POLICY ... ON attempts ...
3. Vitest unit:   it('prevents duplicate attempts', ...)
4. Vitest integ:  it('start → submit → finalize flow', ...)
5. Playwright:    test('complete quiz flow', ...)
6. Run tests against local Supabase stack
7. All pass → merge
```
