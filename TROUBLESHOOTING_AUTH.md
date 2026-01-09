# Troubleshooting Authentication Issues

## Problem: Can't Sign In - "Sign In (Test)" Button Doesn't Work

### Step 1: Enable Anonymous Authentication in Supabase

**Via Supabase Dashboard:**
1. Go to https://supabase.com/dashboard
2. Select your project: `zcvwamziybpslpavjljw`
3. Navigate to **Authentication** → **Providers**
4. Scroll down to find **Anonymous** provider
5. Click the toggle to **Enable** it
6. Click **Save**

**Via SQL (Alternative):**
```sql
-- Run this in Supabase SQL Editor
UPDATE auth.config 
SET enable_anonymous_sign_ins = true;
```

### Step 2: Check Browser Console

1. Open browser DevTools (F12 or Cmd+Option+I)
2. Go to **Console** tab
3. Click "Sign In (Test)" button
4. Look for error messages

**Common Errors:**

**Error: "Anonymous sign-ins are disabled"**
- Solution: Enable anonymous auth (Step 1)

**Error: "Failed to fetch" or CORS errors**
- Solution: Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in `.env.local`

**Error: "Invalid API key"**
- Solution: Verify your anon key in Supabase Dashboard → Settings → API

### Step 3: Verify Environment Variables

Check `apps/web/.env.local` exists and has:
```env
NEXT_PUBLIC_SUPABASE_URL=https://zcvwamziybpslpavjljw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**To get your anon key:**
1. Go to Supabase Dashboard
2. Settings → API
3. Copy "anon public" key

### Step 4: Test Sign-In Flow

1. **Open app**: http://localhost:3000
2. **Check button state**: Should show "Sign In (Test)" (cyan button)
3. **Click button**: Should show loading state briefly
4. **After sign-in**: Button should change to "Sign Out" (green button)
5. **Check console**: Should see successful auth logs

### Step 5: Verify Session Persists

1. After signing in, refresh the page
2. Button should still show "Sign Out" (session persisted)
3. If it resets to "Sign In", check:
   - Browser cookies/localStorage not blocked
   - Supabase URL/key are correct

## Debugging Tips

### Enable Verbose Logging

Add to `apps/web/src/lib/auth.ts`:
```typescript
export async function signInAnonymously() {
  console.log('Attempting anonymous sign-in...');
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('Sign-in error:', error);
    throw error;
  }
  console.log('Sign-in successful:', data);
  return data;
}
```

### Check Network Tab

1. Open DevTools → Network tab
2. Click "Sign In (Test)"
3. Look for request to `/auth/v1/token?grant_type=anonymous`
4. Check response:
   - **200 OK**: Success
   - **400 Bad Request**: Anonymous auth disabled
   - **401 Unauthorized**: Invalid API key

### Test Direct API Call

Open browser console and run:
```javascript
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.0');
const supabase = createClient(
  'https://zcvwamziybpslpavjljw.supabase.co',
  'YOUR_ANON_KEY_HERE'
);
const { data, error } = await supabase.auth.signInAnonymously();
console.log('Result:', { data, error });
```

## Still Not Working?

1. **Clear browser cache and localStorage**
2. **Try incognito/private window**
3. **Check Supabase project status** (Dashboard → Project Settings)
4. **Verify project URL matches** `.env.local`

