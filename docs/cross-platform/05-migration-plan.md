# Migration Plan

Phased execution from today's web-only product to web + iOS + Android from one codebase.

**How to use this:** phases are ordered by dependency, not by preference. Each has an entry condition, a scope, and an exit condition you can actually check. Do not start a phase until its entry condition holds — several phases exist specifically to stop later ones from being built on sand.

**Repo conventions apply** (see `.cursor/rules/git-workflow.mdc` and `.agent/skills/git-workflow-and-prs/SKILL.md`): branch `<type>/<domain>-<slug>`, commits `<type>(<domain>): <imperative summary>`, one PR per phase, never commit to `main`, squash merge. The enforcement gate also applies — schema changes need a migration, access-pattern changes need RLS updates, and correctness work needs tests in the same PR.

---

## Two tracks, not one

Some of the longest-lead work is not engineering at all. **Start the external track on day one** — it blocks nothing else and nothing else can unblock it.

```
ENGINEERING TRACK
Phase 0 preconditions → foundations → export → seam → shell → capabilities → release
      │
      │  runs in parallel, start immediately
      ↓
EXTERNAL TRACK
Apple Developer enrollment ─────────────────────────┐
Google Play account + production-access eligibility ─┴─→ store submission
```

**The Google Play track is the one that bites.** If the Play developer account is a **personal** account created after 2023-11-13, production access requires a closed test with **12 testers opted in for 14 consecutive days**, followed by a human-reviewed written application (~7 days), before production is reachable at all. That is a **multi-week calendar dependency with no engineering shortcut**.

Nobody should reach "Android is ready!" and only then discover the account needs weeks of maturation. Decide the account type and start recruiting testers before Phase 0 finishes. See [release/ANDROID.md](release/ANDROID.md) §4.4 and [release/FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md).

## Phase overview

| # | Phase | Blocks | Rough size |
|---|---|---|---|
| **0** | **Preconditions — 0A…0E** | **Everything** | **2–3 wk** |
| 1 | Remaining correctness fixes | Mobile timer + notification work | 1 wk |
| 2 | Foundations: versioning, environments, CI | Observability, releases | 1–2 wk |
| 3 | Static export compatibility | Capacitor shell | 1 wk |
| 4 | Platform seam + auth port | Native sign-in | 1.5–2 wk |
| 5 | Capacitor shell + app UX pass | Store submission | 2–3 wk |
| 6 | Native capabilities | 4.2 story | 1–2 wk |
| 7 | Push notifications | — | 1.5–2 wk |
| 8 | Store compliance | Submission | 1–2 wk |
| 9 | Release machinery + first submission | Launch | 2–3 wk |

Sizes assume one engineer working with an agent. Within Phase 0, 0A and 0D are independent of 0B and 0C and can run concurrently. Phase 2 parallelizes with Phase 0. Phases 6 and 7 can overlap with 8.

---

## Phase 0 — Preconditions

**No substantive migration implementation begins until every item here passes.**

Phase 0 answers two questions that must not be assumed: *does the architecture work at all?* and *is the product safe to package?* Both have a real chance of changing the plan. Getting the answer after a week of downstream implementation is the expensive outcome.

0A and 0D are architectural go/no-go. 0B and 0C are security preconditions — they are not "Capacitor migration work", but shipping an IPA/APK turns hidden client behavior into something anyone can unzip and read, so they cannot be deferred to "after mobile ships".

---

### 0A — Prove the packaged Capacitor routing model

**This is the architectural go/no-go.** Throwaway branch, no product changes, nothing merged.

1. Set `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`.
2. Temporarily stub the four dynamic routes. **Do not delete them to make the build go green** — a green build produced by deleting the routes under test proves nothing. This happened during the audit and produced a false positive that took a second verification pass to catch.
3. Wrap the export in a bare Capacitor shell. Run on a **real iOS device** and an Android emulator.
4. **Measure the HEAD probe.** Under `output: 'export'` Next fires `fetch(url, {method:'HEAD'})` before every route-cache fill, on every `<Link>` prefetch and `router.prefetch()`. In Capacitor these go through the iOS `WKURLSchemeHandler` / Android `WebViewAssetLoader`, not an HTTP server. If HEAD does not return 2xx, `rejectRouteCacheEntry` fires, the router degrades to a full document load, and that **unmounts `GameProvider` and destroys in-flight quiz state between `/play/q/N` and `/play/q/N+1`.**

   A `python3 -m http.server` test **cannot** detect this — it handles HEAD correctly. Only a real WebView answers the question.

5. Separately: add a `webkit` + mobile-viewport Playwright project against the current app. Cheap, and it converts the central assumption of the Capacitor case into a measurement.

**Exit:**
- [ ] `/play/q/1/ → /play/q/2/` is a client transition on a real device — `GameProvider` not remounted, no white flash
- [ ] A cold boot at a non-root path resolves (validates `trailingSlash`)
- [ ] Avatars render (validates `images.unoptimized`)
- [ ] Findings written up in [STATUS.md](STATUS.md), including anything contradicting [02-current-state.md](02-current-state.md)

**If 0A fails** and no Capacitor server plugin fixes it, the fallback is hoisting game state above the router into module scope + Preferences so an MPA navigation is survivable. That is a real cost. **Revise the architecture before anyone implements downstream work** — re-open [ADR-001](01-architecture-decision.md) rather than treating the plan as settled.

---

### 0B — Fix server-side attempt integrity

[03-blocking-fixes.md](03-blocking-fixes.md) A1, A3, A5.

**A1 — `delete-attempt`.** Any signed-in user can finalize an attempt, read the full answer key from `get-attempt-results`, delete the attempt, and replay for a perfect 100. Daily, repeatably, indistinguishable from a real score. The only thing stopping them today is a client-side `if (!isAdmin)` that hides a button. Delete the function, or move the check server-side, or refuse deletion once `finalized_at` is set.

**A3 — Q1's clock is client-triggered.** `start-attempt` returns all ten questions while leaving Q1's timer unstamped, so a scripted client can research Q1 indefinitely, then fire `start-question-timer` and `submit-answer` back-to-back for the maximum speed bonus. Clamp server-side.

**A5 — the RLS suite never runs.** `supabase/tests` is not in the root `workspaces` array, so `npm test` never reaches ~85 tests including all RLS coverage. It is also stale and hardcodes production credentials as defaults. **This is how A1 and A2 survived** — without it, 0B and 0C cannot be verified, only asserted.

**Exit:**
- [ ] The finalize → read key → delete → replay path is closed, with a test proving it
- [ ] `start-question-timer` rejects or clamps a late start
- [ ] `supabase/tests` runs in CI against a local stack, production defaults removed, stale assertions rewritten

---

### 0C — Secure quiz publishing

[03-blocking-fixes.md](03-blocking-fixes.md) A2.

`publish-quiz` has no auth check at all, and `supabase/config.toml` sets `verify_jwt = false`. Any anonymous POST publishes the newest eligible quiz. It is also **vestigial** — the cron moved to the in-database `publish_scheduled_quiz()`, and that migration was careful to revoke the SQL function from `anon`/`authenticated` while leaving the Edge Function wide open.

Note the fleet-wide posture: `verify_jwt = false` everywhere means **a missing in-function auth check fails OPEN, not closed.** Audit every function for an explicit check while here.

**Exit:**
- [ ] `publish-quiz` deleted, or authenticated and admin-gated
- [ ] Every Edge Function audited for an explicit auth check; findings recorded
- [ ] C9 resolved — verify whether the `scheduled` status actually exists, or the daily cron has been matching zero rows since 2026-04-02

---

### 0D — Prove Capacitor-origin CORS behavior

`supabase/functions/_shared/cors.ts` emits a **single static** `Access-Control-Allow-Origin`, documented to be `https://play10q.com` in production. Capacitor sends `capacitor://localhost` (iOS) or `http://localhost` (Android). One static value cannot serve all three.

Twelve functions import it — and they are exactly the game loop. The other ten hardcode `"*"` inline. **The failure mode is the worst possible shape: leagues and profiles load fine while the quiz dies on every request.** An engineer who hits this mid-Phase-5 will spend a day blaming the client.

Make `corsHeaders` take `req`, echo the Origin when it matches an allow-list, and add `Vary: Origin`. Then **prove it from a real device**, not from a curl with a spoofed header.

**Exit:**
- [ ] `corsHeaders(req)` shipped across all 12 importers and the 10 inline copies consolidated
- [ ] `Access-Control-Allow-Headers` verified to include everything the client sends — a new request header silently fails preflight
- [ ] The full game loop completes from a Capacitor WebView on both platforms, against production CORS config

---

### 0E — Gate: native work may now begin

Not a work item. The explicit checkpoint that 0A–0D all passed.

**Do not create `ios/`, `android/`, or add any `@capacitor/*` dependency to the main branch before this gate clears.** Native project scaffolding is the point of no return for reviewer attention and for the cost of reversing course.

**Gate:**
- [ ] 0A passed on real hardware, or the architecture was revised and [ADR-001](01-architecture-decision.md) updated to match
- [ ] 0B and 0C closed, with tests that run in CI
- [ ] 0D proven from a device
- [ ] [STATUS.md](STATUS.md) records the outcome of each, including anything that changed the plan

---

## Phase 1 — Remaining correctness and hardening

**Entry:** Phase 0 gate cleared (the urgent security work is already done in 0B/0C).
**Branches:** `fix/security-*`, `fix/game-*` — several small PRs, not one.

What is left from [03-blocking-fixes.md](03-blocking-fixes.md) after Phase 0: section A's non-urgent items and all of section C.

**Security hardening** — A4 (`players` is world-readable in full, including `linked_auth_user_id`), A6 (answer secrecy rests on one untested column grant), and the A7 list: no rate limiting anywhere, the unauthenticated and unthrottled `get-profile-by-handle`, the unbounded leaderboard `limit`, and the still-exposed empty `private` schema.

**Correctness** — these are live bugs the native client inherits unless fixed:

- **C1 must land before any mobile timer work.** The DB trigger forces a 16s expiry while all code uses 12s, so a native client that trusts `question_expires_at` shows a timer 4 seconds longer than the one the server scores against.
- **C2** — a timed-out question is submitted as answer A and can be scored as a deliberate correct answer.
- **C3** — the resume adapter reads field names the server does not return, so resume always hands back a fresh timer.
- **C7 blocks Phase 7.** Streaks are computed only at finalize and nothing expires them, so the database cannot tell you a streak is dead — and streak-at-risk push is the highest-value native feature.
- C4, C5, C6, C8, C10 as capacity allows.

**Exit:**
- [ ] A4 and A6 resolved; A7 triaged with decisions recorded
- [ ] C1, C2, C3, C7 fixed with tests
- [ ] An RLS test asserts `is_correct` is unreadable by `anon` and `authenticated`

---

## Phase 2 — Foundations

**Entry:** none. Parallel with 0 and 1.
**Branch:** `chore/release-foundations`

The prerequisites everything downstream assumes. **These are not mobile costs** — they are identical under Capacitor or Expo and should not be attributed to the client-architecture decision.

- **Version source of truth** — see [release/VERSIONING.md](release/VERSIONING.md). Nothing stamps a build id anywhere today; zero git tags exist.
- **A non-production environment.** There is nowhere to point a TestFlight or internal-track binary that is not live production — not in Cloudflare, Supabase, Sentry or PostHog. Because config is build-time-inlined, this means a second build configuration and a second secret set.
- **Fix the CI/deploy env drift** so the artifact CI verifies is the artifact production ships.
- **The five identifiers** from [OBSERVABILITY.md](OBSERVABILITY.md) wired into PostHog and Sentry.
- **Supabase in CI** — migrations and 22 functions are deployed by hand today. Tolerable when clients auto-update; a hazard once a store binary can lag a contract change by weeks.
- **Client version header + minimum-supported-version gate**, server-side. Needed before the first store binary exists, because it is the only lever that works when mobile cannot roll back.

**Exit:**
- [ ] `app_version` / `app_build` readable at runtime on every platform
- [ ] Staging exists end to end and a build can be pointed at it
- [ ] PostHog events carry `client_platform`; Sentry has `release` + `dist` + `client_platform`
- [ ] `X-Client-Version` sent and enforced, with the minimum set permissively for now
- [ ] Both build targets run in CI

---

## Phase 3 — Static export compatibility

**Entry:** Phase 0 exit met.
**Branch:** `feat/web-static-export`

Make `apps/web` produce a valid export **without** breaking the Cloudflare deploy. All of it merges to `main` and ships to web — this phase should be invisible to web users.

- Split the four dynamic routes into server `page.tsx` + `ClientPage.tsx`.
- Convert the three unbounded routes to query params; keep `/play/q/[index]` as-is with `generateStaticParams`.
- Cloudflare redirects for the old `/invite/<code>` shape — **permanent**, this is the growth loop.
- `trailingSlash`, `images.unoptimized`, and the `BUILD_TARGET` config split.
- `scripts/build-native.sh` with the file-shuffle for `middleware.ts`, `instrumentation.ts` and the Sentry server/edge configs. Trap on EXIT so a failed build cannot leave the tree dirty.
- Replace `window.location.origin` in outbound URLs with `PUBLIC_ORIGIN`.
- Clamp `current_index` before routing.
- Delete `src/lib/supabase/server.ts` and the six dead auth exports.
- CI check that fails if the export output contains `/_next/image`.
- A Playwright project serving the export directory statically.

**Exit:**
- [ ] `npm run build` (web) and the native build both pass in CI
- [ ] Export serves correctly from a static server at every route
- [ ] Web is unchanged in production apart from the new redirects
- [ ] Playwright passes against both the dev server and the export

---

## Phase 4 — Platform seam and auth

**Entry:** Phase 3 exit met.
**Branch:** `feat/platform-seam`, then `feat/auth-native`

Build `src/platform/` per [04-shared-code-architecture.md](04-shared-code-architecture.md) and port auth. **This is the largest bounded porting cost in the project.**

- The seam, with web implementations first so nothing regresses.
- ESLint `no-restricted-imports` banning `@capacitor/*` outside `src/platform/`.
- `storage` with the `StorageResult` distinction — **`ok: false` must never mean "create a new anonymous user."** Gate `signInAnonymously()` on a positive "durable and empty" result.
- Migrate `attempt_state` off `sessionStorage`; delete the write-only `quiz_id` / `quiz_questions`.
- Session factory: cookies on web, Preferences on native. **Evaluate converging web onto `createClient` too** and deleting `@supabase/ssr` — it currently buys nothing and one construction is cheaper than two.
- Extract `handleAuthCallback(url)` out of the React page. Fix the dropped `?next=` on the recovery path.
- Native OAuth: `skipBrowserRedirect`, `@capacitor/browser`, custom scheme, `appUrlOpen` listener, `detectSessionInUrl: false`.
- Native Sign in with Apple / Google via `signInWithIdToken` for cold sign-in; keep the redirect flow for `linkIdentity`.
- Rewrite the dead PKCE guard (`lib/auth.ts:63-74`) to key off an explicit flag — it will start firing incorrectly once storage moves.
- Lift `onAuthStateChange` into a top-level provider.
- **Supabase dashboard:** add native redirect URLs. Untracked config — record it in [release/FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md).
- **Backend: the CORS fix.** Prototype this *before* the client port.

**Exit:**
- [ ] Sign-in, sign-out and anonymous→named upgrade all work on a real iOS device and Android emulator
- [ ] Session survives **three cold starts and a reinstall** without minting a new anonymous user
- [ ] The full game loop reaches the Edge Functions from both native origins
- [ ] Web auth is unchanged in production

---

## Phase 5 — Capacitor shell and the app UX pass

**Entry:** Phase 4 exit met.
**Branch:** `feat/capacitor-shell`, then `feat/mobile-ux`

Two workstreams, mergeable independently. **The UX pass ships to web too** — most of it fixes live mobile-Safari bugs.

**Shell:** `capacitor.config.ts`, `ios/`, `android/`, `@capacitor/assets` icons and splash from the brand PNG, `cap sync` wired into the build script.

**UX pass** — priority order from [02-current-state.md §5](02-current-state.md):

- **P0** `viewport` export with `viewportFit: 'cover'`, `themeColor`, `maximumScale: 1`. **This must land before safe-area padding** — `env(safe-area-inset-*)` resolves to 0 on iOS until it does. Pinch-zoom is currently enabled mid-timer.
- **P0** safe-area padding at `ArcadeBackground`, `Toast`, `BottomDock`, the invite CTA, and the two notch-colliding `AuthButton`s.
- **P0** `100vh` → `100dvh` across 46 sites. A live mobile-Safari bug today: the `BottomDock` is pushed below the fold.
- **P0** Android hardware back — the `backButton` listener plus `push` → `replace` for the intra-quiz advances and the corrective redirect. **Highest-risk item in the phase**, because the redirect effect interacts with the optimistic store writes.
- **P1** Wire up `PageTransition.tsx` — 117 lines of finished framer-motion with zero importers. Best effort-to-perceived-nativeness ratio available.
- **P1** Promote `BottomDock` to a real tab bar in the layout, hidden on `/play/*`.
- **P2** Input hygiene (`autoCapitalize`, `autoCorrect`, `inputMode`; the 14px field that triggers iOS focus-zoom).
- **P2** Accessibility floor: `aria-live` on answer correctness — required by the project's own checklist — and `role="dialog"` + focus trap on all five modals.
- **P3** Replace emoji icons with the inline SVG set; profile the always-on `.bg-arcade` composite on a mid-tier Android device.
- Fix the three dead style references (`to-magentaA`, `animate-slide-in`, the `tailwindcss-animate` classes).

**Exit:**
- [ ] App runs on a real iPhone and a real Android device
- [ ] No safe-area collisions in portrait on a notched device
- [ ] Android back behaves per-route and never traps the user in the quiz
- [ ] Mobile Safari regressions fixed and verified on web

---

## Phase 6 — Native capabilities

**Entry:** Phase 5 shell complete.
**Branch:** `feat/native-capabilities`

The genuinely useful ones. Per [ADR-001](01-architecture-decision.md), these are shipped because they make the game better — **not to satisfy Guideline 4.2.**

- Native share sheet. `buildShareText()` already emits a share-ready emoji grid against a button that currently just says "COPIED!". Keep `share_clicked` firing at the same point so the funnel stays continuous.
- Haptics on answer lock-in and correct/wrong.
- Deep links: Universal Links (AASA on `play10q.com` + Associated Domains entitlement) and App Links (`assetlinks.json`). **This is its own workstream, not a footnote on the invite route.**
- Lifecycle handlers with server reconciliation on foreground.
- Offline durability: cache the question payload (`start-attempt` already returns all ten), a durable answer outbox draining on reconnect (safe — `submit-answer` is idempotent), an attempt-state mirror, and a cached results payload.
- One reconciled clock from a measured server offset, replacing the two independent clocks.
- Screen wake lock during a run.

**Full offline play is out of scope** — it would require handing the device the answer key. If a grace window is wanted, that is a server change: accept a queued answer whose *device* timestamp was in-window, capped at a few seconds.

**Exit:**
- [ ] Share sheet and haptics work on both platforms
- [ ] A deep link opens the installed app to the right screen from a cold start
- [ ] A quiz survives backgrounding, app kill and relaunch without losing progress
- [ ] An answer submitted offline lands on reconnect

---

## Phase 7 — Push notifications

**Entry:** Phase 6 lifecycle work done; C7 (streak expiry) fixed.
**Branch:** `feat/push-notifications`

100% greenfield — no service worker, no manifest, no FCM/APNs, no device-token table. **The backend half is the larger part and is identical on any client path.**

- Device-token table with RLS, registration and refresh.
- APNs and FCM credentials.
- A sender. `public.outbox_events` already exists as an append-only domain-event table with no consumer — the natural trigger.
- Daily-drop notification at 11:30 UTC, tied to the existing publish job.
- **Streak-at-risk notification.** Blocked until C7 lands: streaks are computed only at finalize, so nothing expires them and the database cannot tell you a streak is dead.
- Permission priming — ask after a completed first quiz, not on launch.
- Tap routing into the right screen from cold, background and foreground.
- Per-type user preferences (needed for both stores).

**Exit:**
- [ ] Daily drop delivers on both platforms and taps to the quiz
- [ ] Streak-at-risk fires correctly against real streak data
- [ ] Preferences respected; opt-out verified

---

## Phase 8 — Store compliance

**Entry:** parallel with 6–7.
**Branch:** `feat/account-deletion`, `feat/ugc-moderation`

[03-blocking-fixes.md](03-blocking-fixes.md) section B. See [STORE_READINESS.md](STORE_READINESS.md).

- **Account deletion** (Apple 5.1.1(v)) — in-app path plus the web-accessible deletion request URL Google requires. FK cascades are already in place, so teardown is largely free. **Decide the owned-leagues question first**: a naive cascade silently deletes other members' leagues.
- **UGC moderation** (Apple 1.2) — all four mechanisms. The surface is narrow (handles + league names), so remediation is small: a wordlist check in `update-handle` and `create-league`, a report table + endpoint, and a block/hide relation.
- **`leave-league`**, and either drop `add-league-member` or make added membership a pending invitation. Today membership is non-consensual and non-exitable.
- Privacy policy and the deletion request page. Custom terms are good practice but **not an Apple hard blocker** — Apple supplies a Standard EULA by default; do not sequence ToS as a launch gate.
- Wire up `generateXboxStyleHandle` (it exists with zero callers) so auto-handles stop leaking the first 8 hex chars of the auth UUID onto the public leaderboard.
- Reconsider whether `/u/[handle]` and `get-league-by-invite` should stay fully unauthenticated.

**Exit:**
- [ ] A user can delete their account in-app and the owned-leagues rule behaves as decided
- [ ] Report, block and filter all exist and work
- [ ] A user can leave a league
- [ ] Privacy policy and deletion request page live on `play10q.com`

---

## Phase 9 — Release machinery and first submission

**Entry:** Phases 1–8 exits met.
**Branch:** `feat/release-machinery`

Build what [release/](release/) describes: `scripts/release/`, the `.claude/skills/release/` operator skill, promotion gates reading Sentry and PostHog, and the rollback runbooks.

Then execute [release/FIRST_STORE_RELEASE.md](release/FIRST_STORE_RELEASE.md). Much of it needs a human — Apple Developer enrollment, signing, store console work — so start the account and certificate items early; they have real lead time and block nothing else.

**Exit:**
- [ ] `scripts/release/preflight` passes for all three channels
- [ ] TestFlight and Play internal builds installable, with the smoke suite green
- [ ] Riley can pull the repo cold, ask Claude *"how do I release 10Q?"*, and get a correct, executable answer from repository documentation alone

---

## Sequencing notes

**Start immediately, in parallel:** Phase 0 (decides everything), Phase 1 A1–A2 (live security), and the Apple/Google account setup from Phase 9 (long lead time, blocks nothing).

**Do not start Phase 5 before Phase 4.** A shell without working auth on device produces confident-looking progress on an app nobody can sign into.

**Phase 2 is the one most likely to be skipped and most expensive to skip.** Without a version source of truth there is no Sentry `dist`, so a crash from a four-month-old binary cannot be symbolicated; without a staging environment the first TestFlight build points at production; without the minimum-version gate there is no lever at all when a shipped binary misbehaves.

**Re-evaluate at the 0E gate, then again after Phase 3.** 0E is the first honest checkpoint and the cheapest place to change course.

**Re-evaluate after Phase 3.** That is the honest checkpoint: the export works or it does not, and the real cost of the routing divergence is known rather than estimated. If Phase 3 substantially overruns, that is the signal to revisit [ADR-001](01-architecture-decision.md) — not a sunk-cost reason to push on.
