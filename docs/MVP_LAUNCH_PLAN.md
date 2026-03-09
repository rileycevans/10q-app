# 10Q — MVP Launch Plan

Everything remaining before putting a URL in front of real users, in execution order.
Each phase unblocks the next, so sequence matters.

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

---

## Phase 8 — Pre-Launch Verification

*Don't ship until this checklist passes.*

### 8.1 End-to-End Playthrough
1. Open app fresh (incognito)
2. Sign in anonymously → play today's quiz → see results → share card → leaderboard
3. Create a handle → check profile page → check streak
4. Sign in as Riley (admin) → create a quiz for tomorrow → verify it publishes at 11:30 UTC

### 8.2 Fix Known Bugs
- [ ] Anonymous auth UX: post-quiz handle nudge (prompt user to create handle after finalizing if they don't have one)

### 8.3 Smoke Test Edge Functions
Run the key edge functions manually via Supabase dashboard and verify responses are well-formed.

### 8.4 Verify RLS
Confirm no client-side query can read `is_correct` answers or another user's private data.

### 8.5 Check Sentry is Receiving Events
Trigger a test error, confirm it shows in Sentry dashboard.

### 8.6 Check PostHog is Receiving Events
Play through a quiz, confirm `quiz_started` → `answer_submitted` × 10 → `quiz_completed` all appear in PostHog.

---

## Summary Order

| Phase | What | Blocker |
|---|---|---|
| 1 | Connect Supabase, Notion, Sentry, PostHog plugins | Nothing — do this first |
| 2 | DB migrations + streaks schema + Riley admin access | Phase 1 (need Supabase MCP) |
| 3 | Ingest 2770 questions into Supabase | Phase 2 (need DB access + migrations applied) |
| 4 | Streaks logic + UI | Phase 2 (need schema) |
| 5 | Sentry error reporting | Phase 1 (need DSN) |
| 6 | PostHog analytics | Phase 1 (need API key) |
| 7 | Admin UI + `create-quiz` edge function | Phase 3 (question bank must exist first) |
| 8 | Pre-launch verification | All of the above |
