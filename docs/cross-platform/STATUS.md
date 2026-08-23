# Migration Status

The live checkpoint for the Web/iOS/Android migration. **This is not a diary.** Keep it
short enough that it stays true. Update it in the same PR as the work it describes.

Read this immediately after invoking the
[cross-platform migration skill](../../.agent/skills/cross-platform-migration/SKILL.md).
Verify it against `.agent/skills/cross-platform-migration/check-docs` — **if the observed
implementation state contradicts this file, the observation wins and this file is wrong.**

**Last updated:** 2026-08-19

---

**Current phase: Phase 5 — running on a real iPhone; fixing what the device found**

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

**Migrations now deploy from CI (2026-08-21).** All five repository secrets
are set and the Supabase workflow ran green end to end: staging, then
production, both applying `20260820120000_baseline_table_grants.sql`. A
migration reaching production by pipeline rather than by hand is the whole
point of the Phase 2 work — "committed but not deployed" is no longer a state
this system can be in.

Verified after the deploy: the answer key and the auth linkage are still
unreadable by `anon`/`authenticated` — the blanket grant re-applies both
column restrictions at the end of the file, and it held — plus 183 players
and 530 attempts intact, the publish cron alive, play10q.com serving 200, and
`capacitor://localhost` still echoed by the game-loop functions.

**Getting there cost four rounds on the access token**, worth recording so
nobody repeats it. The CLI validates the token as `sbp_` followed by exactly
40 **lowercase hex** characters — verified against CLI 2.84.2 and 2.115.0 by
testing the validator directly. An uppercase letter or a dash is rejected as
`Invalid access token format` *before any network call*, which is the
identical message the CLI uses for a project API key and for a truncated
value. Three unrelated causes, one error string. The workflow now reports the
token's length and whether it contains whitespace — never its value — so the
next failure says which one it is.

**Phase 7 — push notifications (complete except device verification).**

| Item | State |
|---|---|
| Device-token table with RLS | **done** |
| Per-type preferences | **done** — both stores require granular opt-out |
| Delivery log | **done** — makes "did they get it?" answerable and gives retries something to deduplicate against |
| Registration/refresh endpoint | **done** — `register-device-token`, deployed and verified |
| APNs and FCM credentials | **done** — both verified against the real providers, not just present |
| APNs/FCM senders and dispatcher | **done** — preferences respected, dead tokens revoked, deliveries deduplicated |
| Client registration through the seam | **done** — web bundle verified free of the push plugin |
| Permission priming | **done** — after a first completed quiz, not on launch |
| Tap routing | **done** — server sends the route, client sanitises it |
| Daily-drop cron | **done** — 11:32 UTC, and only if a quiz actually published |
| Streak-at-risk cron | **done** — 21:00 UTC, skips streaks of zero |
| Delivery to a real device | **not yet** — needs a build on Riley's phone |
| The sender | not started — blocked on credentials |
| Daily-drop and streak-at-risk triggers | not started |
| Permission priming, tap routing | not started |

**Better starting point than the plan assumed.** `public.outbox_events`
already carries `QuizPublished` and `AttemptCompleted` — 5,841 rows, none
consumed — so the daily-drop trigger is already being recorded and a sender
reads from there rather than needing new instrumentation.

**Design note on the token table.** It keys on the token, not on
`(player, platform)`. A device has one token and it can move between accounts
— someone signs out and a friend signs in on the same phone — so keying on
the token makes the row follow the device and re-point at whoever holds it.
Keying on the player would leave two people both believing they own it, and
receiving each other's notifications.

**Found while verifying: the push tables inherited the blanket grant.**
`20260820120000` set `ALTER DEFAULT PRIVILEGES`, so every new public table is
granted to `anon` automatically — correct for game tables, wrong for device
tokens, where `anon` briefly held
SELECT/INSERT/UPDATE/DELETE/TRUNCATE. RLS blocked it, and that was verified
rather than assumed (all 16 tables have RLS on, and an `anon` INSERT lands
nothing), but a push token table should not rest on one layer. Revoked
explicitly, granted back only what a signed-in player needs, with a CI
assertion so it cannot return. Worth remembering for every future table.

**Phase 8 — store compliance (2026-08-21).** Most of it was already done in
earlier phases. Three things closed since:

**Auto-generated handles no longer leak the auth UUID.** A player who never
chose a handle got `Player` + the first eight hex characters of their auth
UUID, published on the leaderboard. `generateXboxStyleHandle` had existed
with zero callers since the start; it is now wired into `start-attempt` and
`create-league` with collision retry, and a migration renamed the 176 of 185
existing players who carried the leaking form. Safe because none of them had
chosen it — every affected row had `handle_last_changed_at IS NULL`, and the
migration enforces that rather than trusting the observation.

**`get-profile-by-handle` no longer returns the auth UUID.** It is
unauthenticated and returned `players.id`, which is the auth user id for
every row. Now returns `players.public_id`, a separate random uuid. The field
keeps its name and shape because store binaries stay installed for months.

Worth recording that the second problem was **made worse by the first fix**:
replacing UUID-derived handles with generated ones closed a leak but made
handles guessable across a ~250k space, so the whole player base could be
walked and mapped to auth UUIDs. Fixing one exposure created the enumeration
path for another.

**Narrow rate limiting**, for that reason. `get-profile-by-handle` is
unauthenticated, service-role, and a 2.27s multi-join — the cheapest DoS
surface here as well as the enumeration path. 30/minute per caller, fixed
window, failing open. Deliberately not the general limiter the plan defers to
its own workstream; this is the smallest thing that closes the hole and is
easy to delete when edge-level throttling replaces it. Verified in
production: 34 requests in one window gave exactly 30 allowed and 4 refused.

**The owned-leagues question was already answered.** `delete-account`
transfers a league to its longest-standing remaining member before deleting,
and only lets a league cascade away when the departing owner is its only
member. I raised it as an open decision from the plan's text without checking
the code first — it was implemented.

**`get-league-by-invite` stays unauthenticated on purpose.** Invite links are
shared with people who do not have the app, and 32^6 codes from
`crypto.getRandomValues` is not a guessable space.

Still open in Phase 8: the ownership handoff is silent — the inheriting
member is not told. Best folded into Phase 7's notification work rather than
building a one-off path for it.

**Phase 6 — native capabilities (mostly done).**

| Item | State |
|---|---|
| Native share sheet | **done** — through the seam; "COPIED!" now only claims success when the share resolved |
| Haptics | **done** — light tap at answer lock-in, correctness notification on results |
| One reconciled clock | **done** — offset measured from the `Date` header every response already carries, no probe endpoint; 11 tests |
| Offline answer outbox | **done** — queues a failed submission, drains on reconnect or foreground; 8 tests |
| Lifecycle reconciliation on foreground | **done** — `resumeAttempt` refreshes the store when the app returns |
| Screen wake lock | **done** — a 12-second timer runs while someone is reading, not touching |
| Deep links | **partial** — see below |
| Cached results payload | not started |

**Deep links are half-finished on purpose.** The AASA file is written and
declares `/invite/*`, `/u/*` and `/results*`, and the Associated Domains
entitlement exists. Three things remain, none of which should be done by
guessing:

1. **The entitlement is not registered in the Xcode build settings.** That is
   two clicks in Signing & Capabilities; hand-editing `project.pbxproj` risks
   a subtle break that `cap sync` may overwrite anyway.
2. **Cloudflare must serve the extensionless AASA as `application/json`.**
   iOS silently ignores it otherwise and the symptom is just "links open
   Safari" with nothing in any log. Worth a `curl -I` after the next deploy.
3. **Android's `assetlinks.json` is not written at all** — it needs the
   SHA-256 fingerprint of a signing certificate that does not exist yet.

**Not attempted: full offline play.** The plan rules it out and the reason
holds — it would mean shipping the answer key to the device. The outbox only
guarantees an answer *reaches* the server; the server still decides whether a
late one counts.

**0D — the game loop runs from a Capacitor WebView (2026-08-21).** Riley built
`feat/capacitor-shell` and played a full quiz in the iOS simulator: questions
loaded, answers submitted, the results page rendered — against **production**
Edge Functions, from `capacitor://localhost`.

That is 0D's substantive exit criterion — "the full game loop completes from a
Capacitor WebView, against production CORS config" — met for iOS. It is the
first evidence the CORS work holds from an actual WebView rather than from a
curl with a spoofed Origin, which is the distinction the plan draws.

It also re-confirms 0A against the real app: the 0A measurement ran a probe
shell with stubbed routes, and this ran the real game, so the export router
survived real navigation between real questions.

Two parts remain before 0D can be ticked outright:

- **Android is untested.** No Android SDK on the machine yet. Android presents
  `http://localhost` rather than `capacitor://localhost` — a separate
  allow-list entry — so it is genuinely unproven rather than implied by iOS.
- **Simulator, not hardware.** Same caveat already recorded for 0A. The
  simulator exercises the same `WKURLSchemeHandler` path and is strong
  evidence, but the one check that genuinely needs a device is session
  survival across cold starts: a simulator does not reproduce iOS evicting a
  WebView cache under storage pressure, which is the exact failure
  `StorageResult` and the Preferences session exist to prevent.

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

**Phase 2 — Foundations (complete).** The one open row is the native build
target, which cannot exist before Phase 5.

| Exit criterion | State |
|---|---|
| `app_version` / `app_build` readable at runtime on every platform | **done** — `version.json` + `scripts/release/version.mjs`, inlined via `src/lib/version.ts`. Verified in the shipped bundle |
| PostHog carries `client_platform`; Sentry has `release` + `dist` + `client_platform` | **done** — PostHog super properties registered at init; Sentry `release`/`dist`/tags set, and `environment` now comes from the build config rather than `NODE_ENV` (which made every artifact report as production) |
| `X-Client-Version` sent and enforced, minimum set permissively | **done** — `_shared/client-version.ts` gates six door-level functions and returns 426 `CLIENT_UPDATE_REQUIRED`. Inert by default (`MIN_CLIENT_*` unset = `0.0.0`), which is the required end state: armed on day one would brick clients. Never gated on `start-question-timer`, `submit-answer`, `finalize-attempt`, `resume-attempt` or `delete-account` — a gate firing mid-attempt destroys a player's single daily play, and blocking `delete-account` is an App Store 5.1.1(v) violation |
| Staging exists end to end and a build can be pointed at it | **partly** — a second free Supabase project exists with all 19 migrations and 24 functions deployed ([ENVIRONMENTS.md](ENVIRONMENTS.md)). No Cloudflare Worker or seeded data yet, so a build cannot be pointed at it end to end |
| Both build targets run in CI | **partly** — the web target's env drift is fixed and `version.mjs check` runs; the native target does not exist until Phase 5 |
| Migrations reach a database from the repo rather than by hand | **done** — `.github/workflows/supabase.yml` pushes migrations and the 24 10Q functions to staging then production on `main`, gated on the invariants job, with the Cloudflare deploy waiting on it. Production's ledger was reconciled to make this possible (below) |

**Fixed in passing: CI verified a different artifact than production shipped.**
`NEXT_PUBLIC_POSTHOG_KEY` and `_HOST` were supplied only to the deploy job, and
`NEXT_PUBLIC_*` is inlined at build time — so CI was type-checking and building
a bundle with analytics compiled out, then production built a different one.
Both env blocks now match, with a comment saying they must stay in step.

**Near-miss worth recording:** adding `X-Client-Version` would have broken
*every* API request, because `_shared/cors.ts` did not list it in
`Access-Control-Allow-Headers`. Preflight failures are silent — the request
never leaves the browser and the server logs nothing — so this would have
looked like a total client outage with no server-side trace. Caught before
deploy, now asserted in the CORS tests.

**13 of 24 Edge Functions were running stale code in production (found
2026-08-19, fixed).** The `x-client-version` CORS fix was committed in Phase 2
and deployed to only 11 functions. The other 13 — including
`get-profile-by-handle`, `get-league-by-invite`, `report-handle` and
`delete-account` — still rejected the header at preflight.

Every one of those calls failed from the browser. Preflight rejections are
invisible server-side: the request never arrives, so there is nothing in the
logs, and the client sees a bare `TypeError: Failed to fetch`. `delete-account`
failing is an App Store 5.1.1(v) compliance problem, not just a bug.

Found by accident, while clicking through `/u/<handle>` to check a Phase 3
route conversion. Nothing in CI or the test suite would have caught it: the
source was correct the whole time and every test passed. Only the deployed
artifact was wrong.

This is the exact failure the new Supabase deploy workflow exists to prevent —
it deploys all 24 on every push to `main`, so "committed but not deployed"
stops being a state the system can be in. All 24 verified accepting the header
after a manual deploy.

**Phase 5 — UX pass (complete). Shell workstream blocked.** The plan splits
Phase 5 into two independently-mergeable workstreams. The UX pass needs no
Capacitor and **ships to web**, where most of it fixes live mobile-Safari
bugs; it is done. The shell (`capacitor.config.ts`, `ios/`, `android/`) needs
`@capacitor/*`, which 0E blocks.

| Item | Priority | State |
|---|---|---|
| `viewportFit: 'cover'`, `maximumScale: 1` | P0 | **done** — verified in the meta tag |
| Safe-area padding | P0 | **done** — 7 utilities, applied at ArcadeBackground, BottomDock, Toast and the invite CTA |
| `100vh` → `100dvh` | P0 | **done** — one utility override rather than 60 call sites; the dock's bottom edge now sits flush at 812px in a 375×812 viewport |
| Android hardware back | P0 | **done** — per-route policy through the seam, plus push→replace across the play flow |
| Wire up `PageTransition` | P1 | **deliberately not done** — see below |
| `BottomDock` as a real tab bar | P1 | not started |
| Input hygiene | P2 | **done** — autoCapitalize/autoCorrect off on handle fields; the 14px field that triggered iOS focus-zoom is now 16px |
| Accessibility floor | P2 | **done** — `aria-live` on answer correctness, `role="dialog"` + focus trap + Escape on all four modals |
| Dead style references | P3 | **done** — `to-magentaA` was never a token; `animate-slide-in` had no keyframe |
| Emoji icons → SVG; profile `.bg-arcade` | P3 | not started |

**The play flow no longer pollutes history.** Ten questions meant ten history
entries, so back walked a player backwards through questions the server
considers answered — on a game with one attempt per day. Verified end to end:
a full quiz from question 9 through finalize to results left history at 19
entries throughout, and back from results lands on home.

**`PageTransition` is left unwired on purpose.** framer-motion drives
animations from `requestAnimationFrame`, which browsers throttle to zero in a
hidden tab, so a mount animation stays frozen at `initial` — opacity 0 and
offset — indefinitely. That is **pre-existing**: five such animations on
`/results` behave identically on `main`. It matters here because this
environment's browser pane reports `visibilityState: "hidden"` even when
fronted, so the animated path cannot be verified at all. Wiring an
unverifiable decorative feature into five screens would spread a latent
invisible-content bug for no functional gain. The component keeps its
`prefers-reduced-motion` fix, which is a real accessibility improvement and
carries no risk. **Anyone picking this up should verify in a real focused
browser tab first.**

**Phase 5 exit criteria remain unmet** — all four require a real iPhone and
Android device, which is the same device dependency that blocks 0D and Phase
4's native half. The web-observable half of the fourth criterion ("mobile
Safari regressions fixed and verified on web") is done.

**Phase 4 — Platform seam (web half complete).** The seam, the client
convergence and every platform-independent item are done and verified on web.
The native half cannot proceed: it needs `@capacitor/*` dependencies, which
the 0E gate blocks until 0D is proven from a device.

Done:

| Item | State |
|---|---|
| `src/platform/` seam, web implementations first | **done** — 8 capabilities, both implementations each, selected at build time |
| ESLint banning `@capacitor/*` outside `src/platform/` | **done** — and it caught a real mistake while being written |
| `storage` with the `StorageResult` distinction | **done** — 9 tests over read-failure vs empty |
| `attempt_state` off `sessionStorage`; delete `quiz_id`/`quiz_questions` | **done** — verified writing durably in the browser |
| Session factory; evaluate converging web onto `createClient` | **done, converged** — `@supabase/ssr` deleted |
| Extract `handleAuthCallback(url)`; fix the dropped `?next=` | **done** — 17 tests |
| Rewrite the dead PKCE guard | **done** — it keyed off the session key itself and would have thrown for everyone once storage moved |
| Lift `onAuthStateChange` into a provider | **done** — plus a foreground re-check |
| Backend CORS fix prototyped before the client port | **done in Phase 0**, verified live for all three origins |

Blocked on 0E: native OAuth (`skipBrowserRedirect`, `@capacitor/browser`,
custom scheme, `appUrlOpen`), `signInWithIdToken`, and the Preferences storage
adapter. `session.native.ts` currently uses a localStorage-backed adapter —
**safe for a shell build and wrong for a shipped app**, marked TODO(0E) in the
file. Every native module is written with the implementation notes in place so
the port is mechanical once the gate clears.

The four exit criteria all require a real device or emulator, so Phase 4
cannot be signed off before Phase 5 stands up a shell. This mirrors the note
already recorded for 0D.

**Three defects found by testing rather than reasoning during this phase:**

1. **The client convergence orphaned every existing account.** Sessions lived
   in cookies the new client cannot read, so the first load after deploy read
   as "no session" and minted a new anonymous user — the id changed from
   6a6d9fcd to c932b507 in the browser. `ensureSession` now adopts a legacy
   cookie session before concluding anyone is new, and gates
   `signInAnonymously` on `storage.isDurable()`.
2. **The seam selected native implementations in `npm run dev`.** `NATIVE =
   platform !== 'web'` reads correctly and is wrong: `npm run dev` does not go
   through the version-env wrapper, so the flag is undefined and every
   developer got storage that always fails and OAuth that throws. Native is
   now opt-in by explicit `ios`/`android`.
3. **`build-native.sh` never set `CLIENT_PLATFORM`**, so `version.mjs`
   defaulted to `web` and the native app would have shipped the **web** seam.
   The export built cleanly and was silently wrong.

All three were invisible to typecheck, lint and the test suite.

**Phase 3 — Static export (complete).** All four exit criteria met.

| Exit criterion | State |
|---|---|
| `npm run build` (web) and the native build both pass | **done** — `BUILD_TARGET=native` produces a 33-route, 6.2M export; the web target still builds with middleware, the `/sentry-test/server` route handler and the image optimizer intact |
| Export serves correctly from a static server at every route | **done** — `scripts/check-export.sh` validates it, and the Playwright `export` project serves `out/` as plain files |
| Web unchanged in production apart from the new redirects | **done** — every server feature is bound to `!isNative`; verified in the build output |
| Playwright passes against both the dev server and the export | **done** — 4 dev-server tests, 6 export tests |

Three routes moved off dynamic segments, because a static export cannot
enumerate league ids, handles or invite codes:

| Was | Now |
|---|---|
| `/invite/<code>` | `/invite/?code=` |
| `/u/<handle>` | `/u/?handle=` |
| `/leagues/<id>` | `/leagues/view?id=` |

Old shapes 308 permanently. Invite links are the growth loop and sit in
people's message threads, so they have to work indefinitely. The
`/leagues/:id` rule carries a negative lookahead — a bare `:id` swallows
`/leagues/create` and `/leagues/view`, sending anyone clicking "create a
league" into a lookup for a league named "create". Verified against a running
server, not just the config.

`/play/q/[index]` keeps its segment via `generateStaticParams`: a quiz is
always `MAX_QUESTIONS_PER_QUIZ` questions, so the paths are known at build
time. `dynamicParams = false` and the resume index is clamped — in an app
bundle an out-of-range push is a hard 404, not a soft redirect.

Two things worth carrying forward:

- **`window.location.origin` is wrong on native.** It is
  `capacitor://localhost` in the WebView, so an invite link built from it is
  unopenable — and it fails silently, as a link a friend taps and nothing
  happens. Shared URLs now come from `PUBLIC_ORIGIN`.
- **The plan's `/_next/image` CI check does not work as written.** Next inlines
  its image config — including that literal path and `unoptimized:!0` — into a
  framework chunk on every build, so a bare grep fails forever on inert config.
  The check looks for generated `/_next/image?url=` URLs in emitted HTML.

**Production's migration ledger is reconciled (2026-08-19).** `db push` now
reports `Remote database is up to date` against production, and CI deploys
migrations to staging then production before the Cloudflare deploy runs.

It previously refused outright. The ledger held 35 rows: 17 stamped with
dashboard-assigned timestamps rather than repo filenames, and 18 belonging to
the transfers project. `db push` compares remote versions to local *filenames*,
so almost every row looked like "applied remotely, absent locally".

What made it safe:

- **The transfers migrations were recovered first.** All 18 had been applied
  through the dashboard and existed in no repo — their only copy was the
  `statements` column of `schema_migrations`. The record of how the schema was
  built lived inside the database it built. They are now in
  `supabase/transfers-migrations/`, extracted verbatim.
- **The whole ledger was backed up with its SQL**, so the operation was
  reversible rather than merely careful.
- **It was rehearsed on staging.** One row was renamed to a fake dashboard
  timestamp to reproduce the exact failure, repaired, and checked: the SQL
  survived at an identical byte length and the push went clean. Only then did
  it run against production. That rehearsal answered the question that mattered
  — `--status reverted` *deletes* a row, and `--status applied` re-inserts it
  from the local file — which is the difference between reconciling history and
  destroying it.
- **`migration repair` runs no DDL.** It edits only the history table. Verified
  either side of the change: 9 transfers tables, 251 journalists, 96 clubs
  unchanged; 181 players and 527 attempts unchanged; both cron jobs alive; every
  security invariant still holding.

Also found in passing: `replace_publish_quiz_cron` existed only in production's
ledger, which looked like a migration the repo was missing. It is the tail of
`20260402000000_publish_scheduled_quiz_function.sql` — production applied as two
dashboard migrations what the repo keeps in one file. The quiz-publishing cron
is fine, and staging (built purely from the repo) proves it.

**Staging exists (Phase 2).** Second Supabase project `yfzylxospvbipnlbwxno`,
free plan, seeded by applying all 19 repo migrations with `db push` rather than
copying production — so the repo's claim to be the source of truth is now
actually tested somewhere. 24 edge functions deployed. Details and the
relink-to-production discipline in [ENVIRONMENTS.md](ENVIRONMENTS.md).

Two things that shaped this: the free plan caps an org at **two** active
projects, so a third environment costs money; and free projects **pause after
7 days idle**, which matters during the Play closed-test window.

**More migration drift found, benign this time.** Three repo migrations are
absent from production's `schema_migrations` ledger —
`handle_customization`, `admin_tool_rls_and_snapshots`, `quiz_content_source` —
but their objects all exist, so they were applied under different names or by
hand. The schema is right and the ledger is wrong, which is the harmless
version of the answer-key case where the migration genuinely never ran.

**A false alarm worth recording**, because it nearly became a "finding":
`anon` and `authenticated` hold INSERT/UPDATE column grants on
`question_answers.is_correct` and `players.linked_auth_user_id` in both
environments. Those grants are vestigial — the table-level privilege was
revoked, so a real `PATCH` returns `42501` (verified against production). Column
privileges alone do not tell you whether something is reachable; the request
does.

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
