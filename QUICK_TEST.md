# Quick Test Guide - Sign In & Leaderboard

## Step 1: Enable Anonymous Auth (Already Done via SQL)

✅ Anonymous authentication has been enabled in your Supabase project.

## Step 2: Verify Environment Variables

Check that `apps/web/.env.local` exists and contains:
```env
NEXT_PUBLIC_SUPABASE_URL=https://zcvwamziybpslpavjljw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjdndhbXppeWJwc2xwYXZqbGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMDI2NDYsImV4cCI6MjA4Mjg3ODY0Nn0.GWoRvLok0PFJNh84EMjyNulyV_k57iHV0OF5gOdu0lE
```

## Step 3: Start Dev Server

```bash
cd apps/web
npm run dev
```

## Step 4: Test Sign-In

1. Open http://localhost:3000
2. Look for **"Sign In (Test)"** button (cyan, top-right)
3. Click it
4. **Expected**: Button changes to **"Sign Out"** (green)
5. **If error**: Check browser console (F12) for details

## Step 5: Test Leaderboard

1. After signing in, click **"LEADERBOARD"** button (green, home page)
2. Or navigate to http://localhost:3000/leaderboard
3. **Expected**: See leaderboard page with:
   - Time window selector (Today, 7 Days, 30 Days, 1 Year)
   - Score type toggle (Cumulative / Average)
   - View mode toggle (Top Players / Around Me)
   - Leaderboard table (may be empty if no scores yet)

## Step 6: Test Gameplay (Optional)

1. Click **"PLAY NOW"** on home page
2. If quiz exists: Start playing
3. If no quiz: See "Come Back Later" message

## Common Issues

### "Sign In (Test)" button shows error
- **Check**: Browser console (F12 → Console tab)
- **Common fix**: Anonymous auth might need to be enabled in Dashboard
  - Go to: https://supabase.com/dashboard/project/zcvwamziybpslpavjljw/auth/providers
  - Find "Anonymous" provider
  - Toggle it ON
  - Click Save

### Leaderboard shows "No entries yet"
- **This is normal** if you haven't completed any quizzes yet
- Complete a quiz first, then check leaderboard

### Edge Functions not deployed
- The leaderboard functions need to be deployed
- Use Supabase CLI: `supabase functions deploy get-global-leaderboard`
- Or deploy via Supabase Dashboard → Edge Functions

## Next Steps

1. ✅ Sign in works
2. ✅ Leaderboard page loads
3. ⏭️ Deploy Edge Functions (if not done)
4. ⏭️ Complete a quiz to see scores in leaderboard
5. ⏭️ Test score type toggle (Cumulative vs Average)

