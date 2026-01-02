# Phase 2 Testing Guide

## Quick Verification

### 1. Test Edge Functions are Deployed

```bash
# Test get-current-quiz (public endpoint)
curl -X GET "https://zcvwamziybpslpavjljw.supabase.co/functions/v1/get-current-quiz" \
  -H "Content-Type: application/json"
```

Expected: Either `{ ok: true, data: { quiz_id: ... } }` or `{ ok: false, error: { code: "QUIZ_NOT_AVAILABLE" } }`

### 2. Test Database Constraints

```bash
cd scripts
npm run test:phase2
```

This will test:
- ✅ UNIQUE constraint on attempts (prevents duplicate attempts)
- ✅ CHECK constraint on time_ms (enforces 0-16000 range)
- ✅ Server-authoritative timing (expires_at = started_at + 16s)

### 3. Test Scoring Formula

```bash
cd packages/contracts
npm test
```

Expected: 20/20 tests passing

### 4. Manual Edge Function Testing

For authenticated endpoints, you need:

1. **Create a test user:**
   ```typescript
   const { data, error } = await supabase.auth.signUp({
     email: 'test@example.com',
     password: 'testpassword123'
   });
   const token = data.session?.access_token;
   ```

2. **Test start-attempt:**
   ```bash
   curl -X POST "https://zcvwamziybpslpavjljw.supabase.co/functions/v1/start-attempt" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <token>" \
     -d '{"quiz_id": "<quiz_id>"}'
   ```

3. **Test submit-answer:**
   ```bash
   curl -X POST "https://zcvwamziybpslpavjljw.supabase.co/functions/v1/submit-answer" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <token>" \
     -d '{
       "attempt_id": "<attempt_id>",
       "question_id": "<question_id>",
       "selected_choice_id": "<choice_id>"
     }'
   ```

## What to Verify

### ✅ Server-Authoritative Timing
- Check `attempts.current_question_started_at` and `current_question_expires_at` are set
- Verify `expires_at = started_at + 16s` (enforced by trigger)
- Verify timing is calculated server-side, not from client

### ✅ Scoring Formula
- Correct answer at 0ms = 10 points (5 base + 5 bonus)
- Correct answer at 5s = 7.5 points (5 base + 2.5 bonus)
- Correct answer at 10s+ = 5 points (5 base + 0 bonus)
- Incorrect answer = 0 points
- Timeout = 0 points

### ✅ Idempotency
- Calling `start-attempt` twice with same `(player_id, quiz_id)` returns same attempt
- Calling `submit-answer` twice with same `(attempt_id, question_id)` returns same answer

### ✅ Evented Architecture
- Check `outbox_events` table has `AnswerSubmitted` events
- Check `outbox_events` table has `AttemptCompleted` events
- Verify events have all required fields

### ✅ Immutability
- Once `attempts.finalized_at` is set, attempt cannot be updated
- `daily_results` is append-only (no updates after insert)

### ✅ RLS Policies
- Anon users cannot read other users' attempts
- Anon users cannot read `private.correct_answers`
- Users can only read their own attempts/results

## Integration Test Flow

1. **Create test quiz** (via service role)
2. **Create test user** (via Supabase Auth)
3. **Start attempt** → Verify attempt created with timing
4. **Submit answer** → Verify score calculated correctly
5. **Resume attempt** → Verify expiry handling works
6. **Finalize attempt** → Verify `daily_results` written
7. **Verify immutability** → Try to update finalized attempt (should fail)

## Next Steps

Once all tests pass:
1. Deploy Edge Functions to Supabase
2. Set up cron job for `publish-quiz`
3. Create test quiz and verify full flow
4. Proceed to Phase 3 (Client & UI)

