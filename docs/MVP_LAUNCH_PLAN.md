# 10Q — MVP Launch Plan

Everything remaining before putting a URL in front of real users, in execution order.
Each phase unblocks the next, so sequence matters.

> **PR Policy:** Open one PR per phase (where code is changed). Do not merge a phase's PR until all steps in that phase are complete and verified. Phases 1 and 3 involve no committed code changes — no PR needed. Phase 8 is verification only.
>
> Branch naming: `feat/phase-2-db-migrations`, `feat/phase-4-streaks`, etc.
> Each PR title should follow: `feat(<domain>): <short outcome>`

---

## Phase 1 — Connect Tools & MCP Plugins

*Must be done first. Everything else requires DB access or observability foundation.*

### 1.1 Supabase MCP → 10Q Project
- The Supabase MCP currently only sees Sonnet projects (`sonnet-staging`, `sonnet-prod`).
- **Action:** Add the 10Q Supabase project to the MCP server config so we have direct DB/migration access.
- **Why first:** Every subsequent DB step (migrations, seeding, RLS) requires this.

### 1.2 Notion MCP
- **Action:** Connect the Notion MCP plugin so we can reference the Notion spec inline during implementation.
- **Why:** The Notion "Backend & Data Model V1" spec is the source of truth for field names and invariants. Having it accessible while coding prevents drift.

### 1.3 Sentry MCP / Plugin
- **Action:** Connect Sentry MCP or confirm Sentry org/project credentials.
- **Why:** We need the DSN and org slug before we can instrument the app in Phase 5.

### 1.4 PostHog Plugin / Credentials
- **Action:** Confirm PostHog project API key and host.
- **Why:** Same reason — need credentials before instrumentation in Phase 5.

### 1.5 Cloudflare Plugin & Domain Migration
- **Action:** Set up the Cloudflare plugin in Cursor (Riley's AI-assisted IDE).
- **Domain migration steps:**
  1. Log in to current domain registrar → transfer domain to Cloudflare Registrar (or update nameservers to point to Cloudflare).
  2. In Cloudflare dashboard, add the site and confirm DNS is resolving.
  3. In Vercel, add the custom domain and point it to the Cloudflare-proxied DNS record.
  4. Confirm SSL certificate is provisioned (Cloudflare handles this automatically).
- **Why Phase 1:** Domain must be on Cloudflare before Vercel deployment can be linked to the production URL. Doing it early avoids DNS propagation delays blocking launch.
- **Nice-to-haves once on Cloudflare:** DDoS protection, caching rules, Web Analytics as a lightweight PostHog supplement.

### 1.6 Playwright CI — Automated Tests on Every PR

*Set this up before any code PRs merge so every subsequent phase benefits from it.*

#### Create `.github/workflows/playwright.yml`
```yaml
name: Playwright Tests
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        working-directory: apps/web
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
```

#### Add GitHub Secrets
In the repo settings → Secrets → Actions:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Add other env vars as they are introduced in later phases

#### Required E2E Tests to Implement
Playwright config already exists at `apps/web/playwright.config.ts`. Write tests covering:
- Anonymous auth → quiz loads → can answer question 1
- Full quiz completion → results page renders with score
- Share button copies text to clipboard
- Leaderboard loads without error
- Handle creation flow works
- `/tomorrow` countdown renders when quiz already completed

> **Note:** Tests MUST use a dedicated **test Supabase project** (not production) to avoid polluting real data. Set up a staging Supabase project for CI.

---

## Phase 2 — Database: Migrations & Admin Access

*Now that we have Supabase access, apply all pending schema changes and set up the admin user.*

### 2.1 Apply Pending Migrations
Run all migrations in `supabase/migrations/` that haven't been applied to production yet. This includes at minimum:
- `20260309000000_add_quiz_number.sql` — adds `quiz_number` SERIAL to `quizzes` (needed for share cards)
- Any other unapplied migrations from the existing `supabase/migrations/` directory

**Command (once Supabase MCP is connected):**
```sql
-- Verify which migrations are already applied
SELECT name FROM supabase_migrations.schema_migrations ORDER BY name;
```

### 2.2 Write & Apply Streaks Migration
Add streak tracking columns to `players`:
```sql
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS current_streak   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_quiz_date   DATE;
```

### 2.3 Grant Riley Admin Access
- In Supabase Dashboard → Authentication → Users → find Riley's user
- Set `app_metadata`: `{ "role": "admin" }`
- This unlocks the `/admin` route in the frontend (already gated on this flag)

### 2.4 Create `.env.example`
No `.env.example` exists in the repo. Riley's AI won't know what variables to configure.
Create `apps/web/.env.example`:
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Sentry (added in Phase 5)
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=
SENTRY_PROJECT=10q-web
SENTRY_AUTH_TOKEN=

# PostHog (added in Phase 6)
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

### 2.5 Fix Three Critical Bugs in `publish-quiz` ⚠️

Three bugs were found during codebase review that will **silently prevent any quiz from ever publishing**. All three must be fixed before running the import script.

#### Bug 1 — Wrong status filter
`publish-quiz/index.ts` queries for `status = 'draft'`, but the import script creates quizzes with `status = 'scheduled'`. The cron will never find any quizzes to publish.

**Fix:** Change the status filter to match both:
```typescript
.in("status", ["draft", "scheduled"])
```

#### Bug 2 — Tag requirement blocks all imported questions
`validateQuiz` enforces `MIN_TAGS_PER_QUESTION = 1`. All 275 imported quizzes have 0 tags. Every quiz will fail validation and never publish.

**Fix:** Change the constant:
```typescript
const MIN_TAGS_PER_QUESTION = 0; // Tags optional for imported questions
```
Or remove the tag count check entirely from the validator.

#### Bug 3 — `order_index` validation is off-by-one
`validateQuiz` checks that `orderIndexes[i] !== i + 1` (expects 1–10), but the import script and schema use 0-based indexing (0–9). Every quiz we import will fail.

**Fix:** Change the validation to expect 0-based:
```typescript
if (orderIndexes[i] !== i) { // 0–9, not 1–10
```

> After fixing all three bugs, re-deploy the `publish-quiz` edge function:
> ```bash
> supabase functions deploy publish-quiz
> ```

### 🔀 Phase 2 PR
Branch: `feat/phase-2-db-migrations`
Includes: streak migration SQL, `.env.example`, `publish-quiz` bug fixes, edge function redeploy.
Merge before starting Phase 3.

---

## Phase 3 — Ingest Questions into Supabase

*The single biggest blocker. Zero quiz content = app always shows "No quiz available".*

### 3.1 Write the Supabase Import Script
Write `scripts/import-questions.js` that reads `scripts/questions.json` and inserts into Supabase.

**Scheduling strategy (confirmed):**
- The 275 curated quiz sets (original groups of 10) are sorted by their original Firestore date key (chronological order).
- They are re-scheduled starting **March 13, 2026**, one per day.
- Questions within each group retain their original order (`order_index` 0–9).
- `release_at_utc` = the assigned date at **11:30:00 UTC** (matching the publish-quiz cron).
- Any questions that don't belong to a curated set are inserted into the question bank only (no quiz assignment).

**For each question:**
1. Insert into `questions` (`body`)
2. Insert 4 rows into `question_answers` (`body`, `is_correct`, `sort_index`, `question_id`)
3. Tags: skip for now (backfill via admin UI)

**For each curated quiz set (sorted by original date, re-dated from Mar 13):**
1. Insert a row into `quizzes` (`release_at_utc`, `status = 'scheduled'`)
2. Insert 10 rows into `quiz_questions` (`quiz_id`, `question_id`, `order_index` 0–9)

### 3.2 Run the Import Script
```bash
cd scripts && npm run import-questions
```

### 3.3 Verify in Supabase Dashboard
- Check `questions` count (~2769 rows, excluding test doc)
- Check at least one `question_answers` set (4 answers, 1 `is_correct`)
- Check `quizzes` if curated sets were imported

> Phase 3 is script execution only — no PR needed. The import script is already committed.

---

## Phase 3.5 — Deploy with Cloudflare Pages

*Get the app live with auto-deploy before layering in streaks, Sentry, and PostHog. Every merge to `main` deploys automatically.*

### 3.5.1 Connect Repo to Cloudflare Pages
1. In Cloudflare Dashboard → **Pages** → Create a project → Connect to Git → select the `10q-app` repo.
2. Set **build configuration**:
   - Root directory: `apps/web`
   - Framework preset: **Next.js**
   - Build command: `npm run build`
   - Output directory: `.next`
3. Add environment variables in Cloudflare Pages settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Cloudflare assigns a `*.pages.dev` preview URL to confirm it works.

### 3.5.2 Connect Custom Domain
1. In Cloudflare Pages project → **Custom domains** → add your domain.
2. Since the domain is already on Cloudflare (Phase 1.5), DNS is auto-configured.
3. Confirm `https://your-domain.com` loads with SSL active.

### 3.5.3 Auto-Deploy is Now Live
From this point on, **every merge to `main` deploys automatically**. No manual deploy steps in any subsequent phase — merge the PR and Cloudflare Pages picks it up within ~2 minutes.

### 3.5.4 Verify First Live Quiz
- Confirm today's quiz loads (or that the first scheduled quiz publishes on March 13 at 11:30 UTC).
- Verify the `publish-quiz` cron is active: Supabase Dashboard → Edge Functions → Schedules.

> No PR needed — this is a one-time Cloudflare Pages setup.

---

## Phase 4 — Streaks: Logic & UI

*Now that we have DB access and the schema is in place from Phase 2.2, implement the full streak system.*

### 4.1 Update `finalize-attempt` Edge Function
Add streak logic at the end of the finalization transaction:

```typescript
// Get quiz's release date (UTC date only)
const quizDate = new Date(quiz.release_at_utc).toISOString().split('T')[0]; // "YYYY-MM-DD"

// Get player's current streak state
const { data: player } = await supabase
  .from('players')
  .select('current_streak, longest_streak, last_quiz_date')
  .eq('id', userId)
  .single();

let newStreak = 1;
if (player?.last_quiz_date) {
  const yesterday = new Date(quizDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (player.last_quiz_date === quizDate) {
    // Already counted today — idempotent, no change
    newStreak = player.current_streak;
  } else if (player.last_quiz_date === yesterdayStr) {
    // Played yesterday — extend streak
    newStreak = player.current_streak + 1;
  }
  // else: gap in days — reset to 1 (default)
}

const newLongest = Math.max(player?.longest_streak ?? 0, newStreak);

await supabase
  .from('players')
  .update({
    current_streak: newStreak,
    longest_streak: newLongest,
    last_quiz_date: quizDate,
  })
  .eq('id', userId);
```

### 4.2 Return Streak in `finalize-attempt` Response
Add to the response payload:
```json
{ "current_streak": 5, "longest_streak": 12 }
```

### 4.3 Update `get-profile-by-handle` to Return Streak
The profile page should show current and longest streak in the stats cards.

### 4.4 UI — BottomDock Streak Display
- The BottomDock already has a 🔥 icon placeholder linking to `/leaderboard`
- Replace static icon with live streak count from player session
- Display as: `🔥 5`
- Requires fetching player profile data and storing streak in client session/context

### 4.5 UI — Results Page Streak Celebration
- After finalizing, if streak ≥ 2, show a celebratory line in the header card:
  - `🔥 5-day streak!` or `🔥 NEW RECORD — 12 days!`
- Pass streak from finalize response through to results page
  *(finalize already redirects to `/results?attempt_id=...` — can add `&streak=5` as a query param)*

### 4.6 UI — Profile Page Streak Stats
Add `current_streak` and `longest_streak` to the stats grid on `/u/[handle]`.

### 🔀 Phase 4 PR
Branch: `feat/phase-4-streaks`
Includes: `finalize-attempt` edge function update, `get-profile-by-handle` update, BottomDock streak display, results page streak celebration, profile page streak stats.

**After merging, deploy the modified edge functions:**
```bash
supabase functions deploy finalize-attempt
supabase functions deploy get-profile-by-handle
```
Merge before starting Phase 5.

---

## Phase 5 — Sentry Error Reporting

*Instrument the app so we know when things break in production.*

### 5.1 Install Sentry SDK
```bash
cd apps/web && npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```
This wizard generates:
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `next.config.js` patch (source maps upload)

### 5.2 Configure DSN & Environment
Add to `.env.local` and Vercel environment variables:
```
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=...
SENTRY_PROJECT=10q-web
SENTRY_AUTH_TOKEN=...  # For source map upload
```

### 5.3 Verify Error Boundary Integration
The app already has an `ErrorBoundary` component — confirm it calls `Sentry.captureException()`.

### 5.4 Edge Function Sentry Reporting (Optional for MVP)
Supabase Edge Functions run in Deno. Sentry has a Deno-compatible SDK:
```typescript
import * as Sentry from "https://deno.land/x/sentry/index.mjs";
Sentry.init({ dsn: Deno.env.get("SENTRY_DSN") });
```
Add to `_shared/` and wrap edge function handlers. **This is a nice-to-have for MVP.**

### 🔀 Phase 5 PR
Branch: `feat/phase-5-sentry`
Includes: Sentry config files, ErrorBoundary integration, any edge function wrappers.
Merge before starting Phase 6.

---

## Phase 6 — PostHog Analytics

*Know what users are doing so you can iterate.*

### 6.1 Install PostHog SDK
```bash
cd apps/web && npm install posthog-js
```

### 6.2 Initialize PostHog
Create `apps/web/src/lib/posthog.ts`:
```typescript
import posthog from 'posthog-js';

export function initPostHog() {
  if (typeof window === 'undefined') return;
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: true,
  });
}

export { posthog };
```

Add to root layout: `useEffect(() => initPostHog(), [])`.

### 6.3 Instrument Key Events

| Event | Where | Properties |
|---|---|---|
| `quiz_started` | `/play` on attempt start | `quiz_id`, `quiz_number` |
| `answer_submitted` | After each answer | `question_index`, `is_correct`, `time_ms`, `bonus_points` |
| `quiz_completed` | Results page load | `total_score`, `correct_count`, `total_time_ms` |
| `share_clicked` | Share button tap | `quiz_number`, `total_score` |
| `handle_created` | After handle set | — |
| `league_created` | After league created | — |

### 6.4 Identify Users
After sign-in/handle creation:
```typescript
posthog.identify(userId, { handle: player.handle_display });
```

### 🔀 Phase 6 PR
Branch: `feat/phase-6-posthog`
Includes: PostHog init, key event calls, user identification.
Merge before starting Phase 7.

---

## Phase 7 — Minimal Admin UI

*Riley needs a way to author new quizzes without writing SQL.*

> Note: This was partially planned in the earlier implementation plan. Pulling it here in full detail.

### 7.1 Frontend: `/admin` Route
- Gate with `app_metadata.role === 'admin'` check on the server
- Simple page with two sections:
  - **Schedule a Quiz** — pick a date, add 10 questions
  - **Question Bank** — browse/search existing questions, tag them

### 7.2 Question Authoring UI (`/admin/quiz/new`)
For each of 10 question slots:
- Text area: question body
- 4 answer fields (radio to mark which is correct)
- Tag picker (multi-select from existing tags)
- Ability to select an **existing question** from the bank instead of writing a new one

### 7.3 `create-quiz` Edge Function (New)
Accepts:
```json
{
  "release_date": "2026-03-15",
  "questions": [
    {
      "body": "...",
      "answers": [
        { "body": "...", "is_correct": true },
        { "body": "...", "is_correct": false },
        ...
      ],
      "tags": ["history"]
    },
    ...
  ]
}
```
- Auth-gated: only `app_metadata.role === 'admin'`
- Inserts all questions, answers, tags in a transaction
- Creates quiz with `status = 'draft'`
- `publish-quiz` cron picks it up at 11:30 UTC on the release date

### 7.4 Tag Management
- Simple `/admin/tags` page to create new tags
- Tags can be assigned to questions via the question detail view

### 🔀 Phase 7 PR
Branch: `feat/phase-7-admin-ui`
Includes: `/admin` route + auth guard, `/admin/quiz/new` page, `create-quiz` edge function, tag management.
This is the largest PR — keep quiz authoring UI and edge function in the same PR since they’re tightly coupled.
Merge before starting Phase 8.

---

## Phase 8 — Pre-Launch Verification & Bug Fixes

*Don't ship until this checklist passes.*

### 8.1 Fix: Anonymous Auth Handle Nudge
After a user finalizes their quiz, if `player.handle_display` is null, show a modal/bottom sheet prompting them to pick a handle.
- "You finished! Save your score with a username."
- CTA: a handle input + confirm button
- Dismissible (but shows on every results page visit until they set one)

### 8.2 Fix: `/play/finalize` Page — Fragile Attempt ID Lookup
`/play/finalize/page.tsx` currently calls `startAttempt()` again to retrieve the attempt ID, which is a duplicate API call that can race or return the wrong attempt.
**Fix:** Pass `attempt_id` via URL param from `/play/q/[index]` when the last question is answered:
```
router.push(`/play/finalize?attempt_id=${attemptId}`);
```
Then read it from `searchParams` in the finalize page.

### 8.3 Fix: `/tomorrow` "View Results" Link
`/tomorrow/page.tsx` has a "View Results" button linking to `/results` with no `attempt_id`. The results page will fail or show the wrong results.
**Fix:** Pass the attempt ID here too, or derive it from the player's last completed attempt from the API.

### 8.4 Add OG / Social Meta Tags
When users share their results URL (e.g. `play.10q.app/results?attempt_id=...`), it should render a rich preview card on Twitter, Discord, iMessage, etc.
- Add `og:title`, `og:description`, `og:image` to the results page `<head>`
- Static OG image is fine for MVP (e.g. the 10Q logo on a dark background)
- Description can be something like: `"I scored 847 pts on 10Q #12. Can you beat me?"` dynamically generated server-side

### 8.5 End-to-End Playthrough
1. Open app fresh (incognito)
2. Sign in anonymously → play today's quiz → see results → share card → leaderboard
3. Handle nudge appears → create handle → check profile page → check streak
4. Sign in as Riley (admin) → create a quiz for tomorrow → verify it publishes at 11:30 UTC
5. Run Playwright suite and confirm all tests pass

### 8.6 Smoke Test Edge Functions
Run each key edge function from the Supabase dashboard and verify responses are well-formed:
`get-current-quiz`, `start-attempt`, `submit-answer`, `finalize-attempt`, `get-attempt-results`, `publish-quiz`.

### 8.7 Verify RLS
Confirm no client-side query can ever read `is_correct` from `question_answers` or see another user's attempt data.

### 8.8 Verify CORS Is Locked Down
Edge functions currently use `Access-Control-Allow-Origin: *`. Before launch, lock this to the production domain:
```typescript
// In _shared/cors.ts
"Access-Control-Allow-Origin": "https://your-domain.com",
```

### 8.9 Check Sentry Is Receiving Events
Trigger a test error, confirm it shows in Sentry dashboard with correct environment tag.

### 8.10 Check PostHog Is Receiving Events
Play through a quiz, confirm `quiz_started` → `answer_submitted` × 10 → `quiz_completed` all appear in PostHog Live Events.

---

## Summary Order

| Phase | What | Blocker | PR? |
|---|---|---|---|
| 1 | Connect plugins: Supabase, Notion, Sentry, PostHog, Cloudflare | Nothing — do first | No |
| 1.6 | Playwright CI on GitHub Actions | Phase 1 (need GitHub Secrets) | Yes — `feat/phase-1-ci` |
| 2 | DB migrations + streaks schema + Riley admin + `.env.example` + **3 publish-quiz bug fixes** | Phase 1 | Yes — `feat/phase-2-db-migrations` |
| 3 | Ingest 2770 questions (run import script) | Phase 2 (bugs fixed, migrations applied) | No |
| 3.5 | Initial Vercel deployment + custom domain | Phase 3 (need content in DB) | No |
| 4 | Streaks logic + UI + edge function deploy | Phase 2 (need schema) | Yes — `feat/phase-4-streaks` |
| 5 | Sentry error reporting + edge function deploy | Phase 1 (need DSN) | Yes — `feat/phase-5-sentry` |
| 6 | PostHog analytics | Phase 1 (need API key) | Yes — `feat/phase-6-posthog` |
| 7 | Admin UI + `create-quiz` edge function | Phase 3 (question bank must exist) | Yes — `feat/phase-7-admin-ui` |
| 8 | Bug fixes + pre-launch verification | All of the above | Yes — `feat/phase-8-launch-prep` |
