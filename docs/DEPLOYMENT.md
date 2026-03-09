# Deployment Guide

This guide covers deploying the 10Q application to production.

## Prerequisites

- Supabase project (free tier or higher)
- Vercel account (or similar hosting for Next.js)
- Node.js 20+ installed locally
- Supabase CLI installed (`npm install -g supabase`)

## Environment Variables

### Supabase Project Setup

1. Create a new Supabase project at https://supabase.com
2. Note your project URL and anon key from Settings → API

### Required Environment Variables

#### For Next.js App (`apps/web/.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

#### For Supabase Edge Functions

Edge Functions automatically have access to:
- `SUPABASE_URL` (auto-injected)
- `SUPABASE_ANON_KEY` (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)

#### For Google OAuth (Optional)

If using Google OAuth:
1. Create OAuth credentials in Google Cloud Console
2. Add to Supabase Dashboard → Authentication → Providers → Google
3. Set redirect URL: `https://your-domain.com/auth/callback`

## Database Setup

### 1. Run Migrations

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Run all migrations
supabase db push
```

### 2. Verify Schema

Check that all tables are created:
- `quizzes`
- `questions`
- `question_choices`
- `question_tags`
- `profiles`
- `attempts`
- `attempt_answers`
- `daily_results`
- `leagues`
- `league_members`

### 3. Enable RLS Policies

All RLS policies are included in the initial migration. Verify they're active:
```sql
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
```

## Edge Functions Deployment

### Deploy All Functions

```bash
# Deploy all functions at once
supabase functions deploy

# Or deploy individually
supabase functions deploy get-current-quiz
supabase functions deploy start-attempt
supabase functions deploy submit-answer
supabase functions deploy resume-attempt
supabase functions deploy finalize-attempt
supabase functions deploy get-attempt-results
supabase functions deploy publish-quiz
supabase functions deploy get-global-leaderboard
supabase functions deploy get-league-leaderboard
supabase functions deploy create-league
supabase functions deploy get-my-leagues
supabase functions deploy get-league-details
supabase functions deploy add-league-member
supabase functions deploy remove-league-member
supabase functions deploy delete-league
supabase functions deploy update-handle
supabase functions deploy get-profile-by-handle
```

### Verify Functions

Check function status in Supabase Dashboard → Edge Functions

## Next.js App Deployment

### Option 1: Vercel (Recommended)

1. **Connect Repository**
   - Import your GitHub repository to Vercel
   - Vercel will auto-detect Next.js

2. **Configure Build Settings**
   - Root Directory: `apps/web`
   - Build Command: `npm run build`
   - Output Directory: `.next`

3. **Add Environment Variables**
   - Go to Project Settings → Environment Variables
   - Add:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. **Deploy**
   - Push to main branch (auto-deploys)
   - Or manually deploy from Vercel dashboard

### Option 2: Self-Hosted

1. **Build the App**
   ```bash
   cd apps/web
   npm run build
   ```

2. **Start Production Server**
   ```bash
   npm start
   ```

3. **Use Process Manager** (PM2 recommended)
   ```bash
   npm install -g pm2
   pm2 start npm --name "10q-web" -- start
   pm2 save
   pm2 startup
   ```

## Post-Deployment Checklist

### 1. Database
- [ ] All migrations applied
- [ ] RLS policies active
- [ ] Indexes created
- [ ] Unique constraints in place

### 2. Edge Functions
- [ ] All functions deployed
- [ ] Functions accessible via API
- [ ] CORS headers configured
- [ ] Error responses follow standard format

### 3. Authentication
- [ ] Anonymous auth enabled (if using)
- [ ] Google OAuth configured (if using)
- [ ] Redirect URLs set correctly
- [ ] Auth callback route working

### 4. Application
- [ ] Environment variables set
- [ ] App builds successfully
- [ ] Home page loads
- [ ] Auth flow works
- [ ] Quiz flow works
- [ ] Leaderboards load
- [ ] Profile pages work

### 5. Monitoring
- [ ] Error logging configured
- [ ] Performance monitoring set up
- [ ] Uptime monitoring enabled

## Cron Job Setup

### Quiz Publishing (11:30 UTC Daily)

The quiz publishing is handled by a Supabase cron job defined in:
`supabase/migrations/20250101000001_publish_quiz_cron.sql`

Verify it's active:
```sql
SELECT * FROM cron.job WHERE jobname = 'publish_quiz';
```

If not active, enable it:
```sql
SELECT cron.schedule(
  'publish_quiz',
  '30 11 * * *',  -- 11:30 UTC daily
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/publish-quiz',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  ) AS request_id;
  $$
);
```

## Troubleshooting

### Edge Functions Not Working

1. Check function logs in Supabase Dashboard
2. Verify environment variables are set
3. Test function directly with curl:
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/function-name \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json"
   ```

### Database Connection Issues

1. Verify project URL and keys
2. Check RLS policies aren't blocking access
3. Test connection with Supabase client

### Build Failures

1. Check Node.js version (20+ required)
2. Verify all dependencies installed
3. Check TypeScript errors: `npm run typecheck`
4. Review build logs for specific errors

### Authentication Issues

1. Verify auth providers enabled in Supabase Dashboard
2. Check redirect URLs match exactly
3. Verify OAuth credentials are correct
4. Check browser console for errors

## Production Best Practices

### Security
- Never commit `.env.local` files
- Use service role key only in Edge Functions (never in client)
- Enable RLS on all tables
- Use HTTPS only
- Set secure cookie flags

### Performance
- Enable Supabase connection pooling
- Use database indexes effectively
- Cache leaderboard data when possible
- Optimize Edge Function cold starts

### Monitoring
- Set up error tracking (Sentry, etc.)
- Monitor Edge Function execution times
- Track database query performance
- Set up uptime alerts

## Rollback Procedure

### Rollback Database Migration

```bash
# List migrations
supabase migration list

# Rollback to specific migration
supabase db reset
supabase db push --version <target-version>
```

### Rollback Edge Function

```bash
# Deploy previous version
supabase functions deploy function-name --version <previous-version>
```

### Rollback Next.js App

- Vercel: Use deployment history to rollback
- Self-hosted: Deploy previous build

## Support

For issues or questions:
1. Check Supabase logs
2. Review Edge Function logs
3. Check browser console
4. Review application logs

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Vercel Documentation](https://vercel.com/docs)
- [Playwright Testing](https://playwright.dev)

