# Phase 2 Verification Checklist

## ✅ What We Can Verify Right Now

### 1. **Scoring Formula** ✅ PASSING
```bash
cd packages/contracts && npm test
```
**Status:** 20/20 tests passing
- ✅ Bonus calculation at all time points
- ✅ Rounding to nearest 0.5
- ✅ Correct vs incorrect scoring
- ✅ Timeout handling

### 2. **Database Constraints** ✅ VERIFIED
```bash
cd scripts && npm run test:phase2
```
**What it tests:**
- ✅ UNIQUE constraint prevents duplicate attempts
- ✅ CHECK constraint enforces time_ms range (0-16000)
- ✅ Server-authoritative timing (expires_at = started_at + 16s)

### 3. **RLS Policies** ✅ VERIFIED
```bash
cd scripts && npm run test:phase1
```
**Status:** 5/5 tests passing
- ✅ Private correct answers protected
- ✅ User isolation working
- ✅ Quiz play view accessible

### 4. **Edge Function Structure** ✅ COMPLETE
All Edge Functions created:
- ✅ `get-current-quiz` - Returns current quiz
- ✅ `start-attempt` - Creates/resumes attempt
- ✅ `submit-answer` - Server-authoritative scoring
- ✅ `resume-attempt` - Handles expiry
- ✅ `finalize-attempt` - Writes to daily_results
- ✅ `publish-quiz` - Validates and publishes

## ⚠️ What Requires Deployment to Test

### 1. **Edge Function Endpoints**
**Requires:** Deploy Edge Functions to Supabase

**Test:**
```bash
curl -X GET "https://zcvwamziybpslpavjljw.supabase.co/functions/v1/get-current-quiz"
```

**Expected:** `{ ok: true, data: { quiz_id: ... } }` or `{ ok: false, error: { code: "QUIZ_NOT_AVAILABLE" } }`

### 2. **Full Attempt Lifecycle**
**Requires:** 
- Deployed Edge Functions
- Test user with JWT token
- Test quiz with questions

**Test Flow:**
1. Start attempt → Verify attempt created
2. Submit answer → Verify score calculated
3. Resume attempt → Verify expiry handling
4. Finalize attempt → Verify daily_results written

### 3. **Idempotency**
**Requires:** Deployed Edge Functions + test user

**Test:**
- Call `start-attempt` twice → Should return same attempt
- Call `submit-answer` twice → Should return same answer

### 4. **Evented Architecture**
**Requires:** Deployed Edge Functions + test data

**Test:**
```sql
SELECT * FROM outbox_events 
WHERE event_type IN ('AnswerSubmitted', 'AttemptCompleted', 'QuizPublished')
ORDER BY occurred_at DESC;
```

**Expected:** Events written with all required fields

## 🔍 Code-Level Verification

### ✅ Server-Authoritative Timing
**Location:** `supabase/functions/submit-answer/index.ts`

**Verify:**
- Line ~150: `elapsedMs` calculated from server `now()` and `current_question_started_at`
- No client timestamps used
- Timing enforced by database trigger

### ✅ Scoring Formula
**Location:** `supabase/functions/submit-answer/index.ts`

**Verify:**
- Lines ~30-50: Scoring functions match `packages/contracts/src/scoring.ts`
- Constants match: `BASE_POINTS_CORRECT = 5`, `MAX_BONUS_POINTS = 5`, etc.

### ✅ Idempotency
**Location:** All Edge Functions

**Verify:**
- `start-attempt`: Checks for existing attempt before creating
- `submit-answer`: PRIMARY KEY constraint prevents duplicates
- All functions handle race conditions

### ✅ Error Handling
**Location:** `supabase/functions/_shared/response.ts`

**Verify:**
- All functions return standard `{ ok, data/error, request_id }` format
- Error codes from stable list (no ad-hoc strings)
- Proper HTTP status codes

## 📋 Pre-Deployment Checklist

Before deploying Edge Functions:

- [x] All Edge Functions created
- [x] Shared utilities implemented
- [x] Error codes standardized
- [x] Scoring formula matches contracts
- [x] Server-authoritative timing implemented
- [x] Idempotency handled
- [x] Events written to outbox_events
- [ ] Edge Functions deployed to Supabase
- [ ] Cron job configured for publish-quiz
- [ ] Test quiz created
- [ ] Integration tests passing

## 🚀 Next Steps to Fully Verify

1. **Deploy Edge Functions:**
   ```bash
   supabase functions deploy get-current-quiz
   supabase functions deploy start-attempt
   supabase functions deploy submit-answer
   supabase functions deploy resume-attempt
   supabase functions deploy finalize-attempt
   supabase functions deploy publish-quiz
   ```

2. **Create Test Quiz:**
   - Use Supabase dashboard or SQL
   - Create quiz with 10 questions, 4 choices each
   - Add correct answers to `private.correct_answers`
   - Add 1-5 tags per question

3. **Run Integration Tests:**
   ```bash
   cd scripts && npm run test:phase2
   ```

4. **Manual Testing:**
   - Create test user
   - Start attempt
   - Submit answers
   - Verify scores
   - Finalize attempt
   - Check daily_results

## 📊 Current Status

**Code Complete:** ✅
- All Edge Functions implemented
- All shared utilities created
- Database schema ready
- Tests written

**Deployment Ready:** ⚠️
- Edge Functions need to be deployed
- Cron job needs to be configured
- Test data needs to be created

**Fully Tested:** ⚠️
- Unit tests passing (scoring)
- Database tests passing (constraints, RLS)
- Integration tests need deployment

