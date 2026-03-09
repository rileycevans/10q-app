# Testing Guide for 10Q

## Phase 1 Tests

### 1. Scoring Formula Tests

**Location:** `packages/contracts/src/scoring.test.ts`

**Run:**
```bash
cd packages/contracts
npm test
```

**What it tests:**
- ✅ Bonus calculation at all time points (0s, 5s, 10s, 16s)
- ✅ Rounding to nearest 0.5
- ✅ Correct vs incorrect answer scoring
- ✅ Timeout handling
- ✅ Score validation (bounds checking)
- ✅ Edge cases (negative time, over limit)

**Expected:** 20/20 tests pass

### 2. Database Schema & RLS Tests

**Location:** `scripts/test-phase1.ts`

**Run:**
```bash
cd scripts
npm run test:phase1
```

**What it tests:**
- ✅ `quiz_play_view` is accessible and doesn't expose correct answers
- ✅ `private.correct_answers` is protected (not exposed via REST API)
- ✅ `attempts` table has RLS (anon can't see other users' attempts)
- ✅ `daily_results` table has RLS (anon can't see other users' results)
- ✅ Published quizzes are publicly readable

**Expected:** 5/5 tests pass

### 3. RLS Smoke Tests (Vitest)

**Location:** `supabase/tests/rls-smoke.test.ts`

**Run:**
```bash
cd supabase/tests
npm test
```

**Note:** Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment variables.

**What it tests:**
- Private correct answers access control
- Attempt isolation
- Daily results isolation
- Quiz play view security

## Quick Test Commands

```bash
# Run all scoring tests
cd packages/contracts && npm test

# Run database verification
cd scripts && npm run test:phase1

# Run RLS smoke tests (requires env vars)
cd supabase/tests && npm test
```

## What's Working

✅ **Scoring Formula** - All edge cases tested and passing
✅ **Database Schema** - All tables, constraints, indexes created
✅ **RLS Policies** - Access control working correctly
✅ **Views** - `quiz_play_view` accessible, no correct answers exposed
✅ **Private Schema** - `private.correct_answers` properly protected

## Next Steps for Phase 2

When building Edge Functions, you can test:
- Start attempt flow
- Submit answer flow
- Resume attempt flow
- Finalize attempt flow
- Quiz publishing cron job

