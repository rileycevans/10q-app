# Migration Status

The live checkpoint for the Web/iOS/Android migration. **This is not a diary.** Keep it
short enough that it stays true. Update it in the same PR as the work it describes.

Read this immediately after invoking the
[cross-platform migration skill](../../.agent/skills/cross-platform-migration/SKILL.md).
Verify it against `.agent/skills/cross-platform-migration/check-docs` — **if the observed
implementation state contradicts this file, the observation wins and this file is wrong.**

**Last updated:** 2026-08-19

---

**Current phase: Phase 1 complete — Phase 2 (Foundations) is next**

Phase 0's preconditions are answered (0A passed; 0B, 0C, 0D done — 0D's device
check is the one open item, see below) and Phase 1's correctness and hardening
work is finished. Phase 2 does not depend on the outstanding 0D device check.

| | Precondition | State |
|---|---|---|
| **0A** | Packaged Capacitor routing model | **PASSED** on iOS 26.5 simulator — see below |
| **0B** | Server-side attempt integrity | **done** — A1, A3, A5, A6 closed |
| **0C** | Secure quiz publishing | **done** |
| **0D** | Capacitor-origin CORS from a device | **code done, device check pending** — see below |
| **0E** | Gate | **3 of 4 criteria met** — 0D's device check outstanding |

No migration code has landed. `check-docs` still reports the static export,
Capacitor, both native projects, the platform seam and the release scripts as
absent.

**0A — PASSED (measured 2026-08-19).** The architectural go/no-go is answered:
the packaged Capacitor routing model works.

Measured on an iPhone 17 Pro simulator (iOS 26.5) running a real
`output: 'export'` build inside a Capacitor shell, assets served from the
device bundle through `WKURLSchemeHandler` — not an HTTP server, and not
`server.url`.

| | `/play/q/1/` | after tapping through to `/play/q/2/` |
|---|---|---|
| provider `mountId` | `r3epwiwr` | `r3epwiwr` — unchanged |
| provider `mountCount` | 1 | 1 — unchanged |

**`GameProvider` survived the navigation.** Next's export-mode HEAD probe
(`segment-cache/cache.js:855-866`) therefore receives a 2xx from Capacitor's
scheme handler: `rejectRouteCacheEntry` never fired, the router stayed on the
client-transition path, and no document load occurred. In the real app that is
the difference between in-flight quiz state surviving between questions and
being silently destroyed.

Criteria were written to `scratchpad/measure-0a.md` **before** the measurement,
so the bar could not move to fit the result. The earlier static analysis of the
Capacitor binary pointed the same way but was explicitly not accepted as proof;
this is the measurement it was standing in for.

**ADR-001 holds.** No architecture revision needed.

Caveat worth keeping: the plan asks for 0A on **real hardware**. This ran on a
simulator, which exercises the same `WKURLSchemeHandler` code path and is
strong evidence, but a device pass is still worth taking opportunistically
during Phase 5 when a signed build exists.

**Two export blockers found and worth keeping:** `manifest.ts` needs
`export const dynamic = 'force-static'` (already carried back to the working
branch — it is correct for the SSR build too), and
`sentry-test/server/route.ts` is build-fatal under export and must be excluded
from the native build in Phase 3.

**Probe branch:** `throwaway/0a-head-probe`. Never merge. The four dynamic
routes there are stubbed, not deleted.

**0E gate — 3 of 4.** Against the checklist in
[05-migration-plan.md](05-migration-plan.md#0e--gate-native-work-may-now-begin):

- [x] **0A passed** — measured, ADR-001 unchanged. Simulator rather than
      hardware; see the caveat above.
- [x] **0B and 0C closed, with tests that run in CI** — `supabase/tests` is in
      the root workspaces array and a CI job runs the RLS suite against a local
      stack.
- [ ] **0D proven from a device** — the CORS code is shipped and verified
      against production for all three origins, but the plan asks for the full
      game loop from a real Capacitor WebView. The 0A probe shell is a bare
      export with stubbed routes; it does not exercise the game loop. This is
      the one outstanding item.
- [x] **STATUS.md records each outcome**, including the corrections to the
      audit (A5's unit tests were never broken; A6's migration had never been
      applied; CORS was a latent trap rather than a live break).

**Practical read:** 0D's remaining check is a verification step, not a design
question — the architecture risk that 0E exists to guard against was 0A, and it
passed. The natural place to close it is early Phase 5, when a Capacitor shell
first runs the real app rather than a probe. Phases 1–3 do not depend on it.

**Phase 1 — correctness and hardening: done.** C1, C2, C3, C7, A4 fixed with
tests; A6 was closed in Phase 0; A7 triaged below.

**A7 triage (measured 2026-08-19, decisions recorded).** The exit criterion is
a recorded decision per item, not a fix per item.

| Item | Measured | Decision |
|---|---|---|
| Unbounded leaderboard `limit` | `?limit=1000000` accepted. Returned 133 rows (all that exist) but took **1.7s** — the aggregation runs over all of `daily_scores` before slicing, so it is a cost amplifier, not a data leak | **Fixed.** Capped at 200 (`count` at 50) on both global and league leaderboards, with `NaN` falling back to the default rather than propagating |
| `private` schema exposed | Confirmed empty: 0 tables, 0 views, 0 functions. Not reachable with the anon key today | **Fixed.** Removed from `config.toml` `schemas`. Anything a future migration creates there would otherwise be API-reachable by default |
| `get-profile-by-handle` unauthenticated and unthrottled | **2.27s per call**, service-role, heavy multi-join, no auth and no throttle. The cheapest DoS surface in the app | **Deferred to Phase 2**, deliberately. The fix is rate limiting, which needs infrastructure that does not exist yet (no staging, no shared limiter). Adding a bespoke per-function limiter now would be thrown away. Tracked as a Phase 2 exit item |
| No rate limiting or idempotency keys anywhere | `outbox_events.idempotency_key` exists and is **never written** (0 writes across all functions). Nothing throttles attempt cycling or handle enumeration | **Deferred to Phase 2**, same reason. Note the two worst amplifiers are already closed: `delete-attempt` is admin-gated (A1) and `publish-quiz` is deleted (A2), so the unthrottled loop that mattered most is gone |
| Full answer key released at finalize | Inherent to showing a results breakdown. A1 is closed, so the one-shot-per-player guarantee now holds | **Product decision, not a defect.** Acceptable while the leaderboard carries no stakes. Revisit if prizes or ranked play are ever added |

## Completed

- Pre-migration repository audit — [02-current-state.md](02-current-state.md)
- Architecture decision — [ADR-001](01-architecture-decision.md)
- Blocking-fix inventory — [03-blocking-fixes.md](03-blocking-fixes.md)
- Shared code architecture and the platform seam — [04-shared-code-architecture.md](04-shared-code-architecture.md)
- Phased migration plan with exit gates — [05-migration-plan.md](05-migration-plan.md)
- Observability architecture — [OBSERVABILITY.md](OBSERVABILITY.md)
- Testing architecture — [TESTING.md](TESTING.md)
- Store readiness assessment — [STORE_READINESS.md](STORE_READINESS.md)
- Release documentation set — [release/](release/)
- Release operator skill and `scripts/release/` contract stubs
- Migration control skill — `.agent/skills/cross-platform-migration/`

### Store-compliance work landed ahead of the plan

Built and deployed before this plan was written, on the `store-compliance`
branch. It closes part of [03-blocking-fixes.md](03-blocking-fixes.md) section B.
**None of it is migration work and none of it touches the 0E gate** — no
`ios/`, no `android/`, no `@capacitor/*`, no `output: 'export'`.

- **B1 account deletion — done.** `delete-account` Edge Function (deployed),
  in-app Danger Zone in `/settings`, and a migration fixing the two foreign
  keys that would have aborted the delete (`outbox_events.actor_user_id` →
  SET NULL, `players.linked_auth_user_id` → CASCADE). B1's open product
  question is answered: leagues owned by a deleting user **transfer to the
  longest-standing remaining member**; solo-owner leagues cascade away.
  Without this, four of six live leagues would have been destroyed by their
  owner deleting an account.
- **B2 UGC moderation — all four mechanisms now exist**, and **B3 is closed.**
  League names are filtered on the server (`create-league` validated length
  only, so any slur passed verbatim), and `leave-league` gives every member an
  exit from a league they were added to without consent — which is the concrete
  form Apple's "block abusive users" requirement takes here. An owner who
  leaves hands the league to its longest-standing member rather than destroying
  it under everyone else, matching the account-deletion rule.

  League names are free text, so the handle blocklist alone was not enough:
  "F.U.C.K United", "shit_lords", Cyrillic lookalikes, zero-width joiners and
  full-width forms all passed it. Names are now normalised to an ASCII skeleton
  before matching, with runs of isolated letters rejoined so the spelled-out
  form is caught too. Verified not to over-block: initial-heavy names like
  "F C Barcelona" and "S H I E L D" still pass.
- **B2 handle moderation — a two-tier
  handle blocklist enforced *server-side* in `update-handle` (slurs matched
  as substrings; milder terms word-matched, so "Scunthorpe" and "Assassin"
  still work — tuned against `/usr/share/dict/words`, 657 → 82 false
  positives); a `handle_reports` table with a `report-handle` function and
  report UI on `/u/[handle]`; an admin queue at `/admin/reports`.
- **B4 privacy policy — done.** `/privacy` and `/terms`, server-rendered and
  reachable without auth. The policy discloses that PostHog receives the
  signed-in user's email, which the code does today
  (`AuthButton.tsx:54`). ⚠️ The support address in `src/lib/legal.ts` is
  still a placeholder and must point at a monitored inbox before submission.
- **PWA manifest and icon set** — web only (`manifest.ts`, `public/icons/`).

**Docs these findings correct:** [03-blocking-fixes.md](03-blocking-fixes.md)
B1 ("does not exist"), B2 ("zero of the four"), B4, and
[STORE_READINESS.md](STORE_READINESS.md) where it says the same.
[ADR-001](01-architecture-decision.md)'s closing note that account deletion
and UGC moderation are "currently missing entirely" is likewise now stale.

### Phase 0 work landed

**0B — attempt integrity: done (A1, A3, A5, and A6 found in passing).**

- **A1 closed.** `delete-attempt` now has a server-side admin check *and*
  refuses to delete a finalized attempt. The second gate is what kills the
  replay loop and holds even if the role check is misconfigured, since the
  answer key is only released at finalize. Verified against production: an
  ordinary anonymous session that previously reached argument validation now
  gets `403 Admin access required`, with and without a valid `quiz_id`.
- **A3 closed.** `planQuestionTimerStart` backdates Q1's clock to the attempt's
  start when the timer request arrives more than 60s late. Backdating rather
  than rejecting, so a genuinely slow device is charged the delay instead of
  being locked out. Verified against production: a simulated 10-minute stall
  returned an already-expired window instead of a fresh 12s one.
- **A6 — the answer key was live-readable, and is now closed.** Found while
  rewriting the RLS assertions: migration `20260310100000_restrict_is_correct_column.sql`
  existed in the repo but had **never been applied to production** — it is
  absent from `supabase_migrations.schema_migrations`. 10Q's migrations were
  pushed by hand, and this one was missed.

  Consequence, verified before fixing: the publishable anon key that ships in
  the client bundle could read `question_answers.is_correct` for every
  published quiz, **including the current day's**. One HTTP request returned
  every correct answer, with no attempt and no replay — strictly worse than
  A1. Applied 2026-08-19; anon and authenticated now get `42501`, the five
  non-secret columns still read, `quiz_play_view` is unaffected, and a full
  game loop (start → timer → submit) still scores correctly under the service
  role.

  This is the concrete cost of the audit's "Supabase is not in CI" finding:
  a security migration sat unapplied for five months with nothing to catch it.
  Worth an explicit drift check before submission — the repo and the live
  database are not known to agree elsewhere either.
- **A5 partly.** `supabase/tests` is now in the root `workspaces` array, so
  `npm test` reaches it — 183 → **259 tests**. The production URL and anon key
  defaults are gone, the suite refuses any non-local `SUPABASE_URL` unless
  `ALLOW_NON_LOCAL_RLS_TESTS=1`, and a CI job runs it against a real local
  stack.
- **A5 complete — the RLS assertions are rewritten.** 17 assertions across six
  groups, every one checked against the live policies and grants before being
  written, and all 17 verified passing against production (read-only; the
  insert/update cases were confirmed non-destructive). They cover answer-key
  secrecy, attempt and score isolation, quiz visibility, and the admin-only
  moderation queue.

  Two lessons are encoded in them. **RLS filters, it does not error** — an
  unauthenticated SELECT returns `[]` with `error: null`, and a blocked UPDATE
  returns success with zero rows affected. Asserting on `error` was the
  original suite's central mistake, and I repeated it once before the test
  caught me. And `players` is genuinely world-readable, so the suite now
  documents that exposure (A4) rather than asserting the opposite; when A4 is
  fixed those tests flip and must be updated deliberately.

**0C — quiz publishing: done.**

- `publish-quiz` deleted from the repo, from `config.toml`, and from the
  Supabase project. The endpoint now 404s; today's quiz still publishes, since
  the live `pg_cron` job calls `public.publish_scheduled_quiz()` directly.
- **Every Edge Function audited for an explicit auth check.** All 10Q
  functions that mutate state authenticate. Three are unauthenticated by
  design and are **read-only** (verified: zero write ops) —
  `get-current-quiz`, `get-league-by-invite`, `get-profile-by-handle`. They
  remain a privacy and DoS concern (A7), not an integrity hole.
- Four deployed functions belonging to the **separate transfers project**
  (`ingest-claim`, `poll-tweets`, `poll-tweets-batch`, `extract-claim`) have
  no auth check and can write. They are outside 10Q's schema and outside this
  migration's scope, so they were left alone — but they are a live
  unauthenticated-write surface on the same Supabase project and should be
  fixed by whoever owns that work.
- **C9 resolved — the audit's concern is disproved.** The `scheduled` status
  exists and the cron is healthy: 160 published, **115 scheduled through
  December**, and today's quiz released on time at 11:30 UTC. It has not been
  matching zero rows.

## In progress

- **0B remainder** — rewrite the 16 stale RLS assertions so they pass against
  a local stack. Until they do, 0B's exit criterion ("tests that prove the
  invariant") is only half met: A1 and A3 have unit coverage, the RLS layer
  does not.

## Blocked

- Nothing blocked. But see the external track below — it is the longest lead time in the
  program and it is not engineering work.

## Next gate

**The 0E gate** — no substantive migration implementation begins until 0A–0D all pass.
See [05-migration-plan.md](05-migration-plan.md#phase-0--preconditions).

| | Precondition | Kind |
|---|---|---|
| **0A** | Prove the packaged Capacitor routing model on real hardware | architectural go/no-go |
| **0B** | Fix server-side attempt integrity (`delete-attempt`, Q1 clock, run the RLS suite) | security |
| **0C** | Secure quiz publishing (`publish-quiz` is unauthenticated) | security |
| **0D** | Prove Capacitor-origin CORS from a device | architectural go/no-go |
| **0E** | Gate — native work may now begin | checkpoint |

**Do not create `ios/`, `android/`, or add any `@capacitor/*` dependency before 0E clears.**

0A and 0D are independent of 0B and 0C and can run concurrently. Phase 2 (foundations)
parallelizes with all of Phase 0.

### External track — start now, in parallel

Apple Developer enrollment, and especially **Google Play production-access eligibility**.
If the Play account is a personal account created after 2023-11-13, production requires a
closed test with **12 testers opted in for 14 consecutive days**, then a human-reviewed
written application. That is a multi-week calendar dependency with no engineering
shortcut. Decide the account type and start recruiting testers before Phase 0 finishes.

## Important discoveries

- **The HEAD probe is the real risk in Phase 0.** Under `output: 'export'`, Next fires
  `fetch(url, {method:'HEAD'})` before every route-cache fill. In Capacitor these go
  through the iOS `WKURLSchemeHandler` / Android `WebViewAssetLoader`, not an HTTP server.
  If HEAD does not return 2xx the router degrades to full document navigation, which
  unmounts `GameProvider` and destroys in-flight quiz state between questions.
  **`python3 -m http.server` cannot detect this** — it handles HEAD correctly.
- **A green build proved nothing once already.** During the audit, the export build was
  made green by deleting the four dynamic routes under test — a false positive that took
  a second pass to catch. Stub them; do not delete them.
- **Phase 2 is the most likely to be skipped and the most expensive to skip.** No version
  source of truth means no Sentry `dist`, so an old binary's crash cannot be symbolicated.
- **CORS fails in the worst possible shape.** `_shared/cors.ts` emits a single static
  origin. Under Capacitor, leagues and profiles would keep working while the entire game
  loop fails on every request. Proven in 0D, before anyone can waste a day blaming the
  client.
- **Security findings are preconditions, not cleanup.** `delete-attempt` lets an
  authenticated user read the answer key and replay for a perfect score; `publish-quiz`
  is unauthenticated. Neither is "Capacitor work", but shipping an IPA/APK makes hidden
  client behavior trivially inspectable — so they land in 0B/0C, not "after mobile ships".
- **Google Play account maturation can be a four-week gate.** Scheduling, not
  architecture — but it must run in parallel from day one.
- **CORS is a trap, not a live break — measured 2026-08-19.** Production
  currently answers `Access-Control-Allow-Origin: *` for
  `Origin: capacitor://localhost`, so `ALLOWED_ORIGIN` is **not set** as an
  Edge Function secret and the game loop would work from a Capacitor WebView
  today. That is accidental, not designed: the moment anyone follows
  `_shared/cors.ts`'s own instruction to set `ALLOWED_ORIGIN=https://play10q.com`,
  the game loop breaks on native while leagues and profiles keep working.
  0D is still required — it is defusing a trap rather than fixing a live
  break, so it can follow 0B/0C rather than blocking them.
- **The audit overstated A5 — measured 2026-08-19.**
  [02-current-state.md](02-current-state.md) §6 and
  [03-blocking-fixes.md](03-blocking-fixes.md) A5 say the `supabase/tests`
  suite "would fail if anyone ran them". That is true of the 16 RLS smoke
  tests, which are stale, but **not** of the 69 unit tests — they pass today,
  unchanged. The suite was invisible, not broken. Only the RLS half needs
  rewriting, which is a materially smaller job than the audit implies.
- **A1's exploit needs a session, not anonymity — measured 2026-08-19.** The
  Supabase gateway 401s an unauthenticated POST to `delete-attempt`, so it is
  not callable by a stranger with no token. This does **not** soften the
  finding: every visitor is auto-signed-in via `signInAnonymously()`, so any
  visitor already holds the credential the exploit needs. The function still
  has no server-side admin check, and `verify_jwt = false` appears 22 times
  in `config.toml`, so a missing in-function check fails open.

## Known documentation gaps

- `scripts/release/*` are contract stubs that exit non-zero by design. They are not
  release machinery yet — that is Phase 9.
