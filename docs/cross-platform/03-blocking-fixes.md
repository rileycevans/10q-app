# Blocking Fixes — Land These Before Any Store Submission

These are **not** mobile work. Every item here is a defect in the product as it ships on the web today. They are listed separately because **packaging the app as an IPA/APK changes their risk profile**: several are currently protected only by the effort of reading a minified bundle, and an app binary can be unzipped.

None of these are made safer by choosing Expo over Capacitor. They are server-side gaps, so the client architecture decision is orthogonal to fixing them.

> **Ordering:** Section A must land before the first TestFlight/internal-track build. Section B must land before public release. Section C should land alongside the migration because the native client will otherwise inherit the bug.

---

## A. Security — fix before any external build exists

### A1 🔴 CRITICAL — `delete-attempt` is a total leaderboard bypass

**Any signed-in user can score a perfect 100 every day.**

`supabase/functions/delete-attempt/index.ts` authenticates the caller and then performs **no admin check** (`:32-36` is the only gate) before deleting `attempt_answers`, `daily_scores` and `attempts` under service role (`:88-131`). Its own header calls it "Development-only" (`:1-4`), but it is registered for deployment in `supabase/config.toml:54-55` and exposed on the client as `edgeFunctions.deleteAttempt` (`apps/web/src/lib/api/edge-functions.ts:644-654`).

The only thing stopping a normal user today is a **client-side** `if (!isAdmin) return;` at `apps/web/src/app/page.tsx:128`, which merely hides a button.

Full exploit:
1. `start-attempt`, answer all 10 arbitrarily, `finalize-attempt`.
2. `GET get-attempt-results` — returns `is_correct` for all four choices of all ten questions (`get-attempt-results/index.ts:178-185`).
3. `POST delete-attempt {quiz_id}`.
4. `start-attempt` again, answer all 10 correctly in under 3s each → **100 points**.

Repeatable daily, no rate limit, indistinguishable from a legitimate score in `daily_scores`.

**Fix (pick one):** delete the function entirely; **or** move the admin check server-side, mirroring `create-quiz/index.ts:52-61`; **or** refuse deletion once `finalized_at` is set. Deleting it is cleanest — the admin reset flow can move to the `10q-db` tool.

### A2 🟠 HIGH — `publish-quiz` is an unauthenticated service-role write

No `getAuthenticatedUser` call anywhere in the file, and `supabase/config.toml:78-79` sets `verify_jwt = false`. Any anonymous POST publishes the newest eligible quiz and emits a `QuizPublished` outbox event.

Blast radius is bounded (it will not publish before `release_at_utc`), but it can force-publish content you intended to hold or replace, and it can be spammed.

**Note the fail-open posture:** the whole fleet runs `verify_jwt = false` (`config.toml:42-91`) because the gateway cannot validate this project's ES256 keys. **A missing in-function auth check therefore fails OPEN, not closed.** Audit every function for an explicit check.

**Also: it is now vestigial.** The cron job was switched from HTTP to the in-database `publish_scheduled_quiz()` in `supabase/migrations/20260402000000_publish_scheduled_quiz_function.sql:96-102`. That migration was careful to revoke the SQL function from `PUBLIC`/`anon`/`authenticated`; the Edge Function doing the same job was left wide open.

**Fix:** delete the function. It is unauthenticated, unused, and duplicated.

### A3 🟠 HIGH — Q1's clock is client-triggered, worth a free 5-point bonus daily

`start-attempt` deliberately leaves `current_question_started_at` NULL (`:203-216`) while returning **all ten questions and their choices** in `all_questions` (`:261-291`). The Q1 clock starts only when the client calls `start-question-timer`.

A scripted client fetches the whole quiz, researches Q1 for as long as it likes, then fires `start-question-timer` and `submit-answer` back-to-back for an elapsed under 3s and the maximum bonus. Q2–Q10 are immune because the server stamps their start when the previous answer lands.

The UX rationale in the code comment is sound — don't charge the user for navigation latency. **Fix server-side rather than by trusting the client:** reject or clamp a `start-question-timer` arriving more than N seconds after `attempts.started_at`.

### A4 🟡 MEDIUM — `public.players` is world-readable in full

`players_read_public FOR SELECT USING (true)` (`20250119000000_notion_schema_alignment.sql:305-307`) with no column-level GRANT. `SELECT * FROM players` with the publishable anon key returns **every row and every column** for every user — including `linked_auth_user_id`, the `auth.users` FK, which correlates player rows to auth identities.

The policy comment claims "public read of handles, own read of full profile" but nothing implements the narrowing.

**Fix** mirrors what was already done for `question_answers`: `REVOKE SELECT` and re-`GRANT` only `(id, handle_display, handle_canonical, current_streak, longest_streak)`.

### A5 🟡 MEDIUM — the RLS test suite never runs and would fail if it did

`supabase/tests` is not in the root `workspaces` array, so `npm test` (`npm run test --workspaces`) never reaches it — ~85 tests including all RLS coverage are invisible to CI.

It is also stale: it asserts against `correct_answers` (dropped), `daily_results` (renamed to `daily_scores`), `choice_text` (now `answer_body`), and asserts `anon cannot read players table directly` (`:137`) which **directly contradicts the live policy**. Several assertions expect an ERROR where RLS actually returns an empty set.

It also hardcodes the production project URL and anon JWT as defaults (`:10-11`) — **if anyone ran it, it would run against production.**

**This is how A1 and A2 survived.** The project's own shipping gate requires "tests that prove invariants are enforced"; that gate is not wired up.

**Fix:** add `supabase/tests` to CI, repoint it at a local stack, delete the production defaults, and rewrite the stale assertions.

### A6 🟡 MEDIUM — answer secrecy rests on one untested column grant

Row-level policy `question_answers_read_published` is **permissive** for every published quiz; only the column GRANT in `20260310100000_restrict_is_correct_column.sql:5-8` keeps `is_correct` hidden. That is one statement with no test asserting it, in a repo whose RLS tests do not run.

Any future `GRANT SELECT ON public.question_answers`, any new view created without `security_invoker`, or a migration replay out of order re-exposes the entire answer key to the anon key.

**Fix:** add an explicit RLS test asserting `is_correct` is unreadable by `anon` and `authenticated`, and wire it into CI (depends on A5).

### A7 Lower priority, same review

- **No rate limiting, no idempotency keys anywhere.** `outbox_events.idempotency_key` exists and is never written. Nothing throttles `start-attempt`/`delete-attempt` cycling, handle enumeration, or `publish-quiz` spam. Every function runs under service role, so an unthrottled loop is a direct cost risk.
- **`get-profile-by-handle` is unauthenticated, service-role and unthrottled**, running heavy multi-join aggregations per request — the cheapest DoS surface in the app.
- **Unbounded `limit` on `get-global-leaderboard`** (`:30-31`). `?limit=1000000` runs a service-role aggregation over all of `daily_scores`.
- **The `private` schema is still exposed to PostgREST** (`config.toml:7`) though it is now empty — anything a future migration creates there is API-reachable by default.
- **The full answer key is handed to every player at finalize** with no cross-player reveal gate. Inherent to showing a results breakdown, but there is no per-quiz submission window and — because of A1 — not even a one-shot-per-player guarantee. Worth an explicit product decision before the leaderboard carries stakes.

---

## B. Store compliance — hard blockers for App Store review

### B1 🔴 Account deletion does not exist

**Apple Guideline 5.1.1(v).** Zero delete-account path anywhere — repo-wide grep for `delete.?account|deleteUser|admin\.deleteUser` returns nothing across 22 Edge Functions and the entire client API surface. `/settings` has exactly one feature (handle customization) and no danger zone. The only "Danger Zone" in the app deletes a *league*.

Anonymous-by-default does not exempt us: the app creates accounts and persists data against them. Google separately requires an in-app deletion path **and** an online resource where a user can request deletion.

**Build:** a service-role Edge Function calling `auth.admin.deleteUser` plus a `players` row delete. FK cascades are already in place (`attempts`, `daily_scores`, `leagues.owner_player_id`, `league_members` all `ON DELETE CASCADE`), so data teardown is largely free.

**Open product question — decide before building:** what happens to leagues owned by a deleting user? A naive cascade **silently deletes other members' leagues.** Options: transfer ownership to the longest-tenured member, or block deletion until owned leagues are transferred or deleted, or soft-delete the league. Pick one deliberately.

### B2 🔴 Zero of the four UGC moderation mechanisms

**Apple Guideline 1.2.** The UGC surface is handles + league names (see [02-current-state.md §8](02-current-state.md)). Against the four required mechanisms:

| Required | Status |
|---|---|
| Filter objectionable material before it goes live | **Missing.** `update-handle` validates shape only; `create-league` validates length only |
| Report mechanism with timely response | **Missing entirely** — no UI, no table |
| Block abusive users | **Missing**, and worse than absent — see B3 |
| Published developer contact | **Missing** — no privacy policy, terms, or support page |

**Shipping to iOS with literally zero of the four is a predictable rejection.** The remediation is small because the surface is narrow: a wordlist check inside `update-handle` and `create-league`, a report table + endpoint, and a block/hide relation.

### B3 🟠 Leagues are non-consensual and non-exitable

An owner can add any player by handle without their consent (`add-league-member/index.ts:81-122`), and **there is no leave-league endpoint** — only the owner can remove members. A stranger who reads your handle off the public leaderboard can pull you into a league with an arbitrary, unmoderated name, permanently.

This is both a real product defect and the concrete form Apple's "block abusive users" requirement takes here.

**Fix:** add a `leave-league` Edge Function, and either require invite-code self-join only (dropping `add-league-member`) or make added membership a pending invitation the target accepts.

### B4 🟠 Privacy policy required; custom terms are optional

**Do not treat these as the same blocker.**

- **Privacy policy: hard requirement**, both stores, plus App Store privacy disclosures and Google's Data Safety declaration — including the behavior of third-party SDKs (PostHog, Sentry).
- **Custom terms / EULA: not a hard blocker on Apple.** Apple supplies a Standard EULA automatically if you do not provide your own. Having our own ToS is still a good idea for a product with accounts, leagues, competitions and user-visible identities — just don't sequence it as a launch gate.

Also needed: a public web page for account-deletion requests (Google), reachable without installing the app.

### B5 🟢 Sign in with Apple — already satisfied

Guideline 4.8 requires an equivalent privacy-preserving login option when you offer third-party social login. **Sign in with Apple is already implemented** alongside Google, so the requirement is met.

The remaining work is presentational: reviewers expect the **native `AuthenticationServices` sheet**, not a web redirect. See [02-current-state.md §2](02-current-state.md) — this needs `signInWithIdToken`, which is currently unused anywhere in the codebase.

### B6 🟢 No IAP obligation

No monetization surface of any kind exists, so Guideline 3.1.1 risk is nil today. Revisit if a paid tier is ever added — web checkout inside a WebView is exactly the pattern Apple rejects.

---

## C. Correctness — fix alongside the migration

These are live bugs. The native client inherits each one unless fixed.

### C1 The database contradicts the code by 4 seconds

`enforce_question_timing()` unconditionally sets `current_question_expires_at := current_question_started_at + INTERVAL '16 seconds'` on every insert/update of `attempts` (`20250119000000_notion_schema_alignment.sql:396-410`), **overwriting whatever the Edge Function computed.** Every code path uses 12000ms.

So the 12s expiry in the HTTP response is an in-memory plan value; **the persisted value is 16s.** On any refresh or resume path the client reads the 16s deadline out of the DB and the rAF loop counts it down unclamped — **the UI says you answered in time while the server records a timeout.**

`attempt_answers.time_ms CHECK BETWEEN 0 AND 16000` is the same leftover.

**Fix:** migration to bring the trigger and CHECK to 12000. **Any native client that trusts `question_expires_at` inherits this bug**, so it must land before the mobile timer work.

### C2 A timed-out question can be scored as a correct answer

The comment at `play/q/[index]/page.tsx:190-191` says the timeout submits a null `selected_answer_id`. **It does not** — it sends `currentQuestion.answers[0].answer_id` (`:217,221-222`), because `submit-answer` hard-requires a non-null id.

The server reclassifies it as a timeout only if **its own** elapsed ≥ 12000. Because the server's window always starts one round-trip later (see [02-current-state.md §3](02-current-state.md)), a client timeout can land with server elapsed < 12000 — and answer A is recorded as a deliberate selection, scoring **5 base points whenever A happens to be correct** (~25% of the time) for a question the player never answered.

**Fix:** send an explicit timeout flag, or allow a null `selected_answer_id` and let the server insert `answer_kind: 'timeout'`.

### C3 Resume always hands back a fresh timer

`domains/attempt/index.ts:129-130` reads `data.current_question_started_at` / `current_question_expires_at`, but `resume-attempt` returns `question_started_at` / `question_expires_at` (`resume-attempt/index.ts:212-213`). **The timings are therefore always `undefined` after a resume**, and the wrong type declaration at `lib/api/edge-functions.ts:301-302` means TypeScript cannot catch it.

Consequence: resume falls into the Q1 branch and gives the player a fresh 12s UI window on a question whose server clock started earlier. On mobile, resume is the common path, not the rare one.

### C4 `question_tags` schema mismatch breaks tagging in three places

The table is `(question_id, tag_id)` with an FK to `tags` — there is no text `tag` column. But:
- `create-quiz/index.ts:155-168` inserts `{question_id, tag}` rows and **swallows the failure as a warning** — so every quiz created through the admin tool has zero tags.
- `get-profile-by-handle/index.ts:212-218` selects `question_tags ( tag )`, so `category_performance` on the public profile is permanently empty.
- `apps/web/src/app/admin/tags/page.tsx:20-21` errors out.

Only `get-attempt-results` does it correctly. **The `tags` column the client consumes is always empty in practice.**

### C5 `ErrorCodes.INVALID_ANSWER` does not exist

`submit-answer/index.ts:201` references it; it is defined in neither `_shared/response.ts` nor `packages/contracts/src/errors.ts`. At runtime the value is `undefined`, so the anti-cheat rejection for a forged answer id ships `{ code: undefined }` — the client falls through to a generic message, and **the code cannot be alerted on or counted.**

### C6 Client response types are lying

`lib/api/edge-functions.ts` declares `state: string` for `startAttempt` (`:289`) and `current_question_*` names for `resumeAttempt`/`submitAnswer` (`:300-303`, `:323-333`). The server returns `state` only on some branches and uses un-prefixed names. The domain layer papers over it at runtime, so the app works — but the types are wrong, which is how C3 went unnoticed.

### C7 Streaks never expire — blocks the best native feature

Detailed in [02-current-state.md §3](02-current-state.md). Nothing resets a streak on a missed day: no cron, no trigger, no read-time recomputation. **Streak-at-risk push notifications cannot be built on the current data.**

**Fix:** a server-side expiry job, or recompute at read time. Prefer server-side — the client must not be the authority, and the notification sender needs to query it.

### C8 `MIN_TAGS_PER_QUESTION` drift

`packages/contracts/src/constants.ts:15` says `1`; `supabase/functions/publish-quiz/index.ts:14` says `0`. Introduced by a fix in the old MVP plan and never closed.

### C9 The `scheduled` status may not exist

`publish_scheduled_quiz()` selects `WHERE status = 'scheduled'`, but the only CHECK constraint in migration history is `CHECK (status IN ('draft','published','archived'))` and no migration alters it. Meanwhile `create-quiz` inserts `'draft'` and the admin dashboard counts `'scheduled'`.

Either the constraint was changed by hand in the dashboard — **making migrations non-reproducible** — or the cron has silently matched zero rows since 2026-04-02. **Verify against the live database.**

### C10 `packages/contracts/src/scoring.ts` has zero runtime importers

The file the skills designate as the single source of truth is imported by nothing but its own test. The Edge Functions run a hand-maintained Deno copy that admits it in its header. They currently agree; nothing enforces it.

**Fix:** add a test that asserts the two constant sets are identical, so drift fails CI.
