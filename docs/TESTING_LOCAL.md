# Local Testing Guide

## Prerequisites

1. **Supabase Running** (either local or hosted)
   - Local: `supabase start` (requires Supabase CLI)
   - Hosted: Use your project URL and service role key

2. **Environment Variables**
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_SERVICE_KEY` - Service role key (for admin operations)

3. **Dependencies Installed**
   ```bash
   cd scripts
   npm install
   ```

## Step 1: Create a Test Quiz

### Option A: Using the Script (Recommended)

```bash
cd scripts

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key"

# Or use local Supabase
export SUPABASE_URL="http://localhost:54321"
export SUPABASE_SERVICE_KEY="your-local-service-key"

# Run the script
npm run create-test-quiz
```

The script will:
- Create a draft quiz with release date set to next 11:30 UTC
- Add 10 test questions with 4 choices each
- Set correct answers (first choice for questions 1-3, varies for others)
- Add category tags to each question
- Print the quiz ID for reference

### Option B: Manual SQL (Supabase Dashboard)

1. Go to Supabase Dashboard → SQL Editor
2. Run the SQL from the script manually, or use this template:

```sql
-- Create quiz
INSERT INTO quizzes (release_at_utc, status)
VALUES (NOW() + INTERVAL '1 day', 'draft')
RETURNING id;

-- Then create questions, choices, correct answers, and tags
-- (See create-test-quiz.ts for the full structure)
```

## Step 2: Publish the Quiz

### Option A: Test the Publish Function

```bash
# Call the publish-quiz Edge Function
curl -X POST https://your-project.supabase.co/functions/v1/publish-quiz \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

### Option B: Manual Publish (For Testing)

```sql
-- In Supabase SQL Editor, update the quiz status
UPDATE quizzes 
SET status = 'published' 
WHERE id = 'your-quiz-id';
```

## Step 3: Test in the App

1. **Start the dev server** (if not running):
   ```bash
   cd apps/web
   npm run dev
   ```

2. **Open the app**: http://localhost:3000

3. **Sign in** (anonymous or Google)

4. **Click "PLAY NOW"** - should start the quiz

5. **Answer questions** and verify:
   - Timer counts down from 16 seconds
   - Answers submit correctly
   - Score updates
   - Results page shows breakdown

## Step 4: Verify Quiz Data

### Check Quiz Status
```sql
SELECT id, release_at_utc, status, created_at 
FROM quizzes 
ORDER BY created_at DESC 
LIMIT 5;
```

### Check Questions
```sql
SELECT q.id, q.prompt, q.order_index, 
       COUNT(DISTINCT qc.id) as choice_count,
       COUNT(DISTINCT qt.tag) as tag_count
FROM questions q
LEFT JOIN question_choices qc ON q.id = qc.question_id
LEFT JOIN question_tags qt ON q.id = qt.question_id
WHERE q.quiz_id = 'your-quiz-id'
GROUP BY q.id, q.prompt, q.order_index
ORDER BY q.order_index;
```

### Check Correct Answers
```sql
SELECT ca.question_id, ca.correct_choice_id, qc.text as correct_answer_text
FROM private.correct_answers ca
JOIN question_choices qc ON ca.correct_choice_id = qc.id
JOIN questions q ON ca.question_id = q.id
WHERE q.quiz_id = 'your-quiz-id'
ORDER BY q.order_index;
```

## Testing the Publish Validation

The `publish-quiz` function validates:
- ✅ Exactly 10 questions
- ✅ Exactly 4 choices per question
- ✅ 1-5 tags per question
- ✅ Correct answer exists for each question

To test validation failures, try:
1. Create quiz with only 9 questions → should fail
2. Create question with 3 choices → should fail
3. Create question with no tags → should fail
4. Create question without correct answer → should fail

## Troubleshooting

### "Quiz not found" error
- Check quiz exists: `SELECT * FROM quizzes WHERE id = '...'`
- Verify quiz status is 'published'
- Check release_at_utc is <= now()

### "No quiz available"
- Verify a published quiz exists
- Check release_at_utc is in the past
- Verify status = 'published'

### Edge Function errors
- Check Edge Function logs in Supabase Dashboard
- Verify service role key is correct
- Check CORS headers if calling from browser

### Database connection issues
- Verify SUPABASE_URL is correct
- Check service role key has proper permissions
- For local: ensure `supabase start` completed successfully

## Next Steps

After creating a test quiz:
1. ✅ Test the full gameplay flow
2. ✅ Verify scoring works correctly
3. ✅ Test leaderboard updates
4. ✅ Check profile stats update
5. ✅ Test category performance aggregation

