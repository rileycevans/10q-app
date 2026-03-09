# Testing Gameplay - Step by Step Guide

## Prerequisites
- ✅ Next.js dev server running on http://localhost:3000
- ✅ Supabase project configured
- ✅ Edge Functions deployed
- ✅ Test quiz created in database

## Step 1: Enable Anonymous Authentication

### Via Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project: `zcvwamziybpslpavjljw`
3. Navigate to **Authentication** → **Providers**
4. Scroll down to find **Anonymous** provider
5. Click the toggle to **Enable** it
6. Click **Save**

**Alternative: Via SQL**
```sql
-- Run this in Supabase SQL Editor
UPDATE auth.config 
SET enable_anonymous_sign_ins = true;
```

## Step 2: Test Authentication

1. **Open the app**: http://localhost:3000
2. **Look for the "Sign In (Test)" button** in the top-right corner
3. **Click it** to sign in anonymously
4. **Verify**: The button should change to "Sign Out" (green) when authenticated

## Step 3: Test Quiz Flow

### 3.1 Check Quiz Availability
1. Click **"PLAY NOW"** on the home page
2. The app will:
   - Call `get-current-quiz` Edge Function
   - If quiz exists: Start/resume attempt
   - If no quiz: Show "Come Back Later" with countdown

### 3.2 Start an Attempt
1. If authenticated and quiz exists, you'll be routed to `/play/q/1`
2. You should see:
   - HUD with progress (1/10), timer, and score
   - Question card with question text and tags
   - 4 answer buttons

### 3.3 Answer Questions
1. **Click an answer** - Button will show selected state
2. **Wait for feedback** - Shows "Correct" or "Incorrect" with points
3. **Auto-advance** - After 1.5s, moves to next question
4. **Timer** - Counts down from 16 seconds (server-authoritative)

### 3.4 Complete Quiz
1. Answer all 10 questions
2. After question 10, you'll be routed to `/play/finalize`
3. Finalize page shows total score
4. Redirects to `/results` after 2 seconds

## Step 4: Test Resume Functionality

1. **Start a quiz** and answer a few questions
2. **Refresh the page** or navigate away
3. **Return to `/play`**
4. **Verify**: You should resume at the current question index
5. **Test timeout**: Wait 16+ seconds, then refresh - expired questions should auto-advance

## Step 5: Test Edge Cases

### No Quiz Available
- If no quiz is published, you should see "Come Back Later" page
- Shows countdown to next 11:30 UTC

### Already Completed
- Complete a quiz
- Try to play again
- Should route to `/tomorrow` page with "Come Back Tomorrow" message

### Timer Expiry
- Start a question
- Wait 16+ seconds without answering
- Refresh page
- Question should auto-fail and advance

## Troubleshooting

### "Authentication required" error
- **Fix**: Make sure you clicked "Sign In (Test)" button
- **Check**: Anonymous auth is enabled in Supabase dashboard

### "No quiz available" error
- **Fix**: Make sure a quiz is published in the database
- **Check**: Run `get-current-quiz` Edge Function manually to verify

### "Failed to start attempt" error
- **Fix**: Check browser console for detailed error
- **Common issues**:
  - Not authenticated (need to sign in)
  - Quiz not published
  - Database connection issue

### Timer not working
- **Fix**: Check that `current_question_expires_at` is being set
- **Verify**: Server timestamps are being used (not client-side)

## Manual Testing Checklist

- [ ] Anonymous auth enabled in Supabase
- [ ] Can sign in via "Sign In (Test)" button
- [ ] Can see quiz availability check
- [ ] Can start an attempt
- [ ] Can see question with 4 answer choices
- [ ] Timer counts down correctly
- [ ] Can select an answer
- [ ] Feedback shows (Correct/Incorrect)
- [ ] Auto-advances to next question
- [ ] Can complete all 10 questions
- [ ] Can finalize attempt
- [ ] Can see results (or placeholder)
- [ ] Can resume in-progress attempt
- [ ] Expired questions auto-advance on resume

## Next Steps After Testing

1. **Implement Results Page**: Fetch and display actual attempt results
2. **Add Google OAuth**: Replace anonymous auth with Google sign-in
3. **Add Profile Creation**: Auto-generate handles for anonymous users
4. **Add Leaderboards**: Display global and league leaderboards
5. **Add Stats**: Show user statistics and category performance
