# Practice Quiz Guide

## Understanding Practice Quizzes

In the 10Q system, there's no separate "practice quiz" concept. Instead, you create **test quizzes** that work exactly like production quizzes. The key difference is:

- **Draft quizzes** (`status = 'draft'`) - Created but not visible to users
- **Published quizzes** (`status = 'published'`) - Live and accessible via the app

## Why You Can't See Your Test Quiz

The test quiz creation script creates quizzes with `status = 'draft'`. The app only shows quizzes with `status = 'published'` and `release_at_utc <= now()`. This is why you can't see or use it yet!

## How to Create and Use a Test Quiz

### Step 1: Create a Test Quiz

```bash
cd scripts

# Set your Supabase credentials
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key"

# Or if using local Supabase
export SUPABASE_URL="http://localhost:54321"
export SUPABASE_SERVICE_KEY="your-local-service-key"

# Run the script
npm run create-test-quiz
```

This will:
- Create a quiz with 10 test questions
- Set status to `'draft'`
- Set `release_at_utc` to the next 11:30 UTC
- Print the quiz ID

### Step 2: Publish the Quiz

You have two options:

#### Option A: Use the Publish Edge Function (Recommended)

```bash
curl -X POST https://your-project.supabase.co/functions/v1/publish-quiz \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

This will:
- Validate the quiz (10 questions, 4 choices each, tags, correct answers)
- Change status from `'draft'` to `'published'`
- Make it available in the app

#### Option B: Manually Publish via SQL

```sql
-- In Supabase SQL Editor, update the quiz status
UPDATE quizzes 
SET status = 'published' 
WHERE id = 'your-quiz-id-from-step-1';
```

**Important**: For testing, you may also want to set `release_at_utc` to the past so it's immediately available:

```sql
UPDATE quizzes 
SET status = 'published',
    release_at_utc = NOW() - INTERVAL '1 hour'
WHERE id = 'your-quiz-id';
```

### Step 3: Access in the App

1. **Start your dev server**:
   ```bash
   cd apps/web
   npm run dev
   ```

2. **Open the app**: http://localhost:3000

3. **Sign in** (click "Sign In" button - supports anonymous auth for testing)

4. **Click "PLAY NOW"** - should now start the quiz!

## How the Quiz System Works

### Quiz States

- **Draft** (`status = 'draft'`): Created but not visible. Used for preparing quizzes before release.
- **Published** (`status = 'published'`): Live and accessible. Users can start attempts.

### Quiz Selection Logic

The app uses the `get-current-quiz` Edge Function which:
1. Finds quizzes where `status = 'published'`
2. Filters to `release_at_utc <= now()` (already released)
3. Orders by `release_at_utc DESC` (most recent first)
4. Returns the first one, or `QUIZ_NOT_AVAILABLE` if none found

### Quiz Publishing Schedule

In production:
- Quizzes are published daily at **11:30 UTC**
- A cron job runs `publish-quiz` Edge Function
- Only one quiz is live at a time

For testing:
- You can publish manually at any time
- Set `release_at_utc` to the past for immediate availability

## Checking Existing Quizzes

To see what quizzes exist in your database:

```sql
-- List all quizzes
SELECT id, release_at_utc, status, created_at 
FROM quizzes 
ORDER BY created_at DESC;

-- Check if any are published and available
SELECT id, release_at_utc, status, created_at 
FROM quizzes 
WHERE status = 'published' 
  AND release_at_utc <= NOW()
ORDER BY release_at_utc DESC;
```

## Quick Test Checklist

- [ ] Test quiz created (status = 'draft')
- [ ] Quiz published (status = 'published')
- [ ] `release_at_utc` is in the past (for immediate testing)
- [ ] User signed in to the app
- [ ] Click "PLAY NOW" - quiz should start!

## Troubleshooting

### "No quiz available" error

**Check:**
1. Quiz exists: `SELECT * FROM quizzes WHERE id = '...'`
2. Status is `'published'`: `SELECT status FROM quizzes WHERE id = '...'`
3. `release_at_utc` is in the past: `SELECT release_at_utc FROM quizzes WHERE id = '...'`

**Fix:**
```sql
UPDATE quizzes 
SET status = 'published',
    release_at_utc = NOW() - INTERVAL '1 hour'
WHERE id = 'your-quiz-id';
```

### Quiz exists but app shows "Come Back Later"

This means:
- Quiz is published ✅
- But `release_at_utc` is in the future ⏰

**Fix:**
```sql
UPDATE quizzes 
SET release_at_utc = NOW() - INTERVAL '1 hour'
WHERE id = 'your-quiz-id';
```

### Edge Function errors

Check Edge Function logs in Supabase Dashboard:
- Go to Edge Functions → `get-current-quiz` → Logs
- Look for errors or validation failures

## Practice vs Production Quizzes

There's no technical difference! Both are:
- Same database structure
- Same validation rules
- Same gameplay flow

The only difference is:
- **Test quizzes**: Created manually, published immediately for testing
- **Production quizzes**: Created via content pipeline, published at 11:30 UTC daily

You can create as many test quizzes as you want for development and testing!
