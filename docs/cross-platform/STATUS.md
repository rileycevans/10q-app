# Migration Status

The live checkpoint for the Web/iOS/Android migration. **This is not a diary.** Keep it
short enough that it stays true. Update it in the same PR as the work it describes.

Read this immediately after invoking the
[cross-platform migration skill](../../.agent/skills/cross-platform-migration/SKILL.md).
Verify it against `.agent/skills/cross-platform-migration/check-docs` — **if the observed
implementation state contradicts this file, the observation wins and this file is wrong.**

**Last updated:** 2026-08-18

---

**Current phase: Phase 0 — Preconditions (0A–0E)** (in progress)

| | Precondition | State |
|---|---|---|
| **0A** | Packaged Capacitor routing model on real hardware | **in progress, blocked on tooling** — see below |
| **0B** | Server-side attempt integrity | **A1, A3 fixed; A5 partly** — RLS tests still stale |
| **0C** | Secure quiz publishing | **done** |
| **0D** | Capacitor-origin CORS from a device | **not started** — latent, not a live break |
| **0E** | Gate | not reached |

No migration code has landed. `check-docs` still reports the static export,
Capacitor, both native projects, the platform seam and the release scripts as
absent.

**0A — prototype built, measurement blocked.** Branch
`throwaway/0a-head-probe` (never merge) has a working `output: 'export'` build
wrapped in a Capacitor shell, with the four dynamic routes **stubbed, not
deleted**. What is proven so far, and what is not:

*Confirmed.* The HEAD probe is real in the version we ship. Next 16.1.6,
`client/components/segment-cache/cache.js:855-866`: under `isOutputExportMode`
it issues `fetch(url, {method:'HEAD'})` and calls `rejectRouteCacheEntry` for
any status `<200` or `>=400`, degrading the navigation to a document load.
`play/layout.tsx` does wrap every question route in `GameProvider`, so a
document load would destroy in-flight quiz state exactly as the audit says.

*Confirmed.* The export builds. `/play/q/[index]` is genuinely enumerable —
all ten routes emit real `index.html` files, and those files are present in the
synced iOS bundle, so the HEAD targets exist.

*Not proven.* Whether Capacitor's `WKURLSchemeHandler` answers a HEAD request
with a 2xx. Static inspection of the Capacitor 8 binary is suggestive —
`WebViewAssetHandler` references `httpMethod`, builds `HTTPURLResponse` with an
explicit `statusCode`, and the only literal HTTP-method string in the framework
is `POST` (its bridge), with no HEAD special-case — which is consistent with
serving any method as 200. **That is inference from a stripped binary, not a
measurement, and it is precisely the kind of evidence this plan says not to
accept.** 0A stays open.

**Blocked on:** `xcodebuild` cannot build for any destination because the
**iOS 26.5 platform is not installed**. Xcode 26.6 ships that SDK; only iOS
18.0 and 18.2 simulator runtimes exist locally, and the error is explicit —
*"iOS 26.5 is not installed. Please download and install the platform from
Xcode > Settings > Components."* This is a separate problem from the earlier
`IDESimulatorFoundation` plugin failure, which `sudo xcodebuild
-runFirstLaunch` did fix. Install the platform, then re-run the probe branch.

Note the plan requires 0A on **real hardware**. A simulator exercises the same
`WKURLSchemeHandler` path and would be strong evidence, but is not the gate.

**Two export blockers found and worth keeping:** `manifest.ts` needs
`export const dynamic = 'force-static'` (already carried back to the working
branch — it is correct for the SSR build too), and
`sentry-test/server/route.ts` is build-fatal under export and must be excluded
from the native build in Phase 3.

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
  report UI on `/u/[handle]`; an admin queue at `/admin/reports`. The
  remaining gap is **block/hide abusive users**, which is B3 (leagues are
  non-consensual and non-exitable) — still open.
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

**0B — attempt integrity (A1, A3 done; A5 partly).**

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
- **A5 partly.** `supabase/tests` is now in the root `workspaces` array, so
  `npm test` reaches it — 183 → **259 tests**. The production URL and anon key
  defaults are gone, the suite refuses any non-local `SUPABASE_URL` unless
  `ALLOW_NON_LOCAL_RLS_TESTS=1`, and a CI job runs it against a real local
  stack. **Still open:** the 16 RLS assertions are stale (they reference
  `correct_answers`, `daily_results`, `choice_text` and assert
  `anon cannot read players`, which contradicts the live policy). They are
  skipped, not passing. Rewriting them is the remainder of 0B.

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
