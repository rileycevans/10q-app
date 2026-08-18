# Migration Plan

Phased execution from today's web-only product to web + iOS + Android from one codebase.

**How to use this:** phases are ordered by dependency, not by preference. Each has an entry condition, a scope, and an exit condition you can actually check. Do not start a phase until its entry condition holds — several phases exist specifically to stop later ones from being built on sand.

**Repo conventions apply** (see `.cursor/rules/git-workflow.mdc` and `.agent/skills/git-workflow-and-prs/SKILL.md`): branch `<type>/<domain>-<slug>`, commits `<type>(<domain>): <imperative summary>`, one PR per phase, never commit to `main`, squash merge. The enforcement gate also applies — schema changes need a migration, access-pattern changes need RLS updates, and correctness work needs tests in the same PR.

---

## Phase overview

| # | Phase | Blocks | Rough size |
|---|---|---|---|
| 0 | Prove the export runs in a WebView | Everything | 2–3 d |
| 1 | Security + correctness fixes | Any external build | 1–2 wk |
| 2 | Foundations: versioning, environments, CI | Observability, releases | 1–2 wk |
| 3 | Static export compatibility | Capacitor shell | 1 wk |
| 4 | Platform seam + auth port | Native sign-in | 1.5–2 wk |
| 5 | Capacitor shell + app UX pass | Store submission | 2–3 wk |
| 6 | Native capabilities | 4.2 story | 1–2 wk |
| 7 | Push notifications | — | 1.5–2 wk |
| 8 | Store compliance | Submission | 1–2 wk |
| 9 | Release machinery + first submission | Launch | 2–3 wk |

Sizes assume one engineer working with an agent. Phases 1 and 2 are substantially parallelizable with each other; 6 and 7 can overlap with 8.

---

## Phase 0 — Prove it

**Entry:** none. Do this first.
**Branch:** throwaway. Nothing here gets merged.

The gate from [ADR-001](01-architecture-decision.md). One prototype, no product changes.

1. `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`.
2. Temporarily stub the four dynamic routes. **Do not delete them to make the build go green** — a green build produced by deleting the routes under test proves nothing. This happened during the audit and produced a false positive that took a second pass to catch.
3. Wrap the export in a bare Capacitor shell. Run on a real iOS device and an Android emulator.
4. **Measure the HEAD probe.** Under `output: 'export'` Next fires `fetch(url, {method:'HEAD'})` before every route-cache fill. In Capacitor these go through the iOS `WKURLSchemeHandler` / Android `WebViewAssetLoader`, not an HTTP server. If HEAD does not return 2xx, the router degrades to full document navigation — which unmounts `GameProvider` and destroys in-flight quiz state between questions.

   A `python3 -m http.server` test **cannot** detect this; it handles HEAD correctly.

5. Separately, add a `webkit` + mobile-viewport Playwright project against the current app. Cheap, and it converts the central assumption of the Capacitor case into a measurement.

**Exit:**
- [ ] `/play/q/1/ → /play/q/2/` is a client transition on a real device — `GameProvider` not remounted, no white flash
- [ ] A cold boot at a non-root path resolves (validates `trailingSlash`)
- [ ] Avatars render (validates `images.unoptimized`)
- [ ] Findings written up, including anything that contradicts [02-current-state.md](02-current-state.md)

**If the HEAD probe fails** and no Capacitor server plugin fixes it, the fallback is hoisting game state above the router into module scope + Preferences so an MPA navigation is survivable. That is a real cost — re-weigh against Expo before continuing.

---

## Phase 1 — Security and correctness

**Entry:** none. Parallel with Phase 0.
**Branches:** `fix/security-*`, `fix/game-*` — several small PRs, not one.

Everything in [03-blocking-fixes.md](03-blocking-fixes.md) sections A and C. These are live web defects; packaging just makes several of them trivially discoverable.

**Section A must land before any external build exists** — before TestFlight, before an internal Play track. `delete-attempt` (A1) is the one to do first: any signed-in user can currently score a perfect 100 daily, protected only by a client-side `if (!isAdmin)`.

**Section C should land before the phases that inherit the bug.** In particular C1 (the DB trigger forcing a 16s expiry against 12s code) must land before any mobile timer work, because a native client that trusts `question_expires_at` inherits a timer 4 seconds longer than the one the server scores against.

**Exit:**
- [ ] A1–A6 resolved; A7 triaged with decisions recorded
- [ ] C1, C2, C3, C7 fixed with tests
- [ ] `supabase/tests` runs in CI against a local stack, with production defaults removed
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

Build what [release/](release/) describes: `scripts/release/`, the `.agent/skills/release/` operator skill, promotion gates reading Sentry and PostHog, and the rollback runbooks.

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

**Re-evaluate after Phase 3.** That is the honest checkpoint: the export works or it does not, and the real cost of the routing divergence is known rather than estimated. If Phase 3 substantially overruns, that is the signal to revisit [ADR-001](01-architecture-decision.md) — not a sunk-cost reason to push on.
