---
name: Error Handling & Structured Logging
description: Return standard error envelopes with stable error codes and implement structured JSON logging with correlation IDs. Applies when writing Edge Functions, API responses, error handling, or logging statements.
---

# Error Handling & Structured Logging

## When This Skill Applies

- Implementing Edge Functions or API endpoints
- Writing error responses or handling failures
- Adding logging to client or server code
- Implementing retry logic or graceful degradation
- Debugging production issues (this skill defines what traces should exist)

## Scope

| Area | Files / Paths |
|------|--------------|
| Error codes | `packages/contracts/errors.ts` |
| Server logging | `supabase/functions/_shared/utils.ts` (`logStructured`) |
| Edge Functions | `supabase/functions/*/index.ts` |
| Client logging | `apps/web/src/lib/logger.ts` (or equivalent) |

## Guidelines

### Standard Error Codes (Defined in `packages/contracts/errors.ts`)

| Code | Meaning |
|------|---------|
| `ATTEMPT_ALREADY_COMPLETED` | Operation on finalized attempt |
| `ATTEMPT_NOT_FOUND` | Attempt does not exist |
| `ATTEMPT_ALREADY_EXISTS` | Duplicate attempt for same quiz |
| `QUESTION_ALREADY_ANSWERED` | Duplicate answer submission |
| `QUESTION_EXPIRED` | Question time limit exceeded |
| `QUIZ_NOT_AVAILABLE` | No current quiz available |
| `NOT_AUTHORIZED` | Authentication/authorization failure |
| `VALIDATION_ERROR` | Input validation failure |
| `LEAGUE_NOT_FOUND` | League does not exist |
| `NOT_A_MEMBER` | User not member of league |
| `NO_VIEWER_SCORE` | User has no score in requested window |

Never invent ad-hoc error strings. Use only codes from `errors.ts`.

### Error Response Envelope

Every Edge Function returns this shape:
- **Success:** `{ ok: true, data: T, request_id: string }`
- **Error:** `{ ok: false, error: { code: string, message: string, details?: unknown }, request_id: string }`

### DB Constraint → Error Code Mapping

| Constraint | Error Code |
|-----------|------------|
| `UNIQUE(player_id, quiz_id)` | `ATTEMPT_ALREADY_EXISTS` |
| `PRIMARY KEY (attempt_id, question_id)` | `QUESTION_ALREADY_ANSWERED` |
| `FOREIGN KEY` violations | `VALIDATION_ERROR` |
| RLS policy denial | `NOT_AUTHORIZED` |
| Missing resource | `*_NOT_FOUND` |

### Retry Rules

- Safe retries for idempotent operations only (answer submission enforced by PK, reads).
- Non-idempotent operations require idempotency keys.
- `409 CONFLICT` or `400 BAD_REQUEST` for non-retryable errors.
- `Retry-After` header for transient failures.

### Graceful Degradation

- Leaderboard lag/failure → fall back to computing from `daily_scores` (slower but correct).
- Quiz publish failure → `503 QUIZ_NOT_AVAILABLE` with clear message.
- Database connection failure → `503 SERVICE_UNAVAILABLE` with retry guidance.
- Never expose internal errors to client.

### Structured Logging Format

Use structured JSON with consistent shape: `event`, `scope`, `requestId`/`actionId`, `timestamp`, plus context.

**Server-side:** Use `logStructured(requestId, eventType, data)` from `_shared/utils.ts`.
**Client-side:** Structured logger outputting JSON matching server pattern.

### Event Types (UPPER_SNAKE_CASE)

| Event | Required Fields |
|-------|----------------|
| `QUIZ_LOADED` | `quizId`, `questionCount`, `serverTs` |
| `QUESTION_SHOWN` | `questionIndex`, `questionId`, `attemptId` |
| `ANSWER_SELECTED` | `questionId`, `selectedChoiceId`, `attemptId`, `clientTs` |
| `SUBMIT_STARTED` | `actionId`, `attemptId`, `questionId`, `clientTs`, `remainingMs` |
| `SUBMIT_ACKED` | `actionId`, `requestId`, `attemptId`, `questionId`, `status`, `reason`, `durationMs`, `serverTs`, `clientTs` |
| `STATE_TRANSITION` | `from`, `to`, `reason`, `attemptId` |
| `NETWORK_REQUEST` | `method`, `endpoint`, `requestId`, `status`, `durationMs`, `retryCount` |
| `ERROR` | `errorName`, `errorMessage`, `scope`, `context` |

### Scopes

Use lowercase identifiers: `auth`, `quiz`, `timer`, `network`, `storage`, `ui`, `league`, `leaderboard`.

### Correlation IDs

- `requestId` for network requests.
- `actionId` (UUID) generated at start of user action, included on all related logs.
- Both client and server timestamps when server-authoritative timing is involved.

### What Must Never Be Logged

- Auth tokens, refresh tokens, cookies
- PII (email, phone, address)
- Full request/response payloads

Log instead: `payloadBytes`, `payloadKeys`, `userIdHash = sha256(userId).slice(0, 8)`.

### Log Levels

- `LOG_LEVEL` env var: `info` in prod, `debug` in staging/local.
- `ENABLE_DIAGNOSTIC_LOGS` flag or `?debug=1` for verbose logging.
- Classify expected errors as `warn` not `error` (validation rejections, timer expiry).

### Flight Recorder (Client-Side)

- In-memory ring buffer of last ~500–2000 log events.
- On error, print: `"Diagnostic bundle id: {bundleId}"`.
- "Copy debug bundle" button exports sanitized JSON to clipboard.

## Anti-Patterns

- Returning ad-hoc error strings: `{ error: 'Something went wrong' }`
- Inconsistent error format across functions
- Missing `request_id` in responses
- Exposing internal errors: `{ error: 'Database connection failed' }`
- Unstructured logging: `console.log("User clicked submit")`
- Logging sensitive data (tokens, PII)
- Inconsistent event naming (mixing case styles)
- Retrying non-idempotent operations

## Examples

**Valid error response:**
```typescript
if (attempt.finalized_at) {
  return {
    ok: false,
    error: {
      code: 'ATTEMPT_ALREADY_COMPLETED',
      message: 'Attempt has already been completed',
    },
    request_id: requestId,
  };
}
```

**Valid structured log:**
```typescript
logStructured(requestId, "SUBMIT_ACKED", {
  scope: "quiz",
  action_id: actionId,
  attempt_id: attemptId,
  question_id: questionId,
  status: "accepted",
  duration_ms: 145,
  server_ts: new Date().toISOString(),
  reason: "valid_answer_within_time",
});
```
