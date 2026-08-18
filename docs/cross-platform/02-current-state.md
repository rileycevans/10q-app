# Current State Audit

**Date:** 2026-08-18 · **Commit:** `af86e61` · **Method:** 12 parallel agents, 3 adversarial verification passes

This is the evidence base for [ADR-001](01-architecture-decision.md). It exists so the next engineer does not re-derive it. Every claim cites `file:line`. Where the audit contradicted itself, that is called out rather than smoothed over.

> **Provenance warning.** Some empirical claims in the original audit were produced by agents running builds concurrently against the live working tree, which contaminated each other's results. Two specific claims were later disproved: that `@supabase/ssr` was missing from `node_modules` (it is present at 0.10.2), and a `HEAD /play/q/2/ → 404` result used as proof of dynamic-route failure (it 404'd because `trailingSlash` was unset, not because of `dynamicParams`). **Anything below marked ⚠️ UNVERIFIED must be re-measured in Gate 0 before you rely on it.**

---

## 1. Rendering architecture — the gate

| Fact | Location |
|---|---|
| 22 of 23 `page.tsx` / `layout.tsx` are `"use client"` | `apps/web/src/app/**` |
| The exception, `layout.tsx`, is a static Server Component (exports `metadata`, emits preconnect tags) | `apps/web/src/app/layout.tsx:22-38,49-59` |
| Zero Server Actions | repo-wide grep for `"use server"` |
| Zero SSR fetching, zero `revalidate`, zero dynamic `generateMetadata` | — |
| Only `next/headers` importer is dead | `apps/web/src/lib/supabase/server.ts` — **zero importers** |
| Only route handler is a debug throw with `force-dynamic` | `apps/web/src/app/sentry-test/server/route.ts` |
| Middleware refreshes a session nothing server-side reads | `apps/web/src/middleware.ts:30` (`getUser()`), `:34` (`no-store`) |

**Conclusion: no server-rendering dependency.** Static export is achievable.

### Static-export blockers

| # | Blocker | Severity | Fix | Effort |
|---|---|---|---|---|
| 1 | 4 dynamic routes, no `generateStaticParams`. 3 are unbounded (`/leagues/[id]`, `/u/[handle]`, `/invite/[code]`); `/play/q/[index]` is bounded 1–10 | **hard** | Query-param routes for the 3 unbounded; `generateStaticParams` for `/play/q` | 0.5–1 d |
| 2 | `"use client"` and `generateStaticParams` are mutually exclusive — all 4 dynamic pages are client components | **hard** | Split each into server `page.tsx` + `ClientPage.tsx` | 1–2 h |
| 3 | `trailingSlash` unset → export emits flat `leagues.html`, but links are extensionless. Capacitor's WebView serves files literally and will not append `.html` | **hard** | `trailingSlash: true` → emits `leagues/index.html` | 5 min |
| 4 | `next/image` silently targets `/_next/image`, which does not exist in a static bundle. **Next 16 does not error at build time** | **hard** | `images.unoptimized: true` for native only; drop `unoptimized={false}` at `profile/page.tsx:161`. Add a CI check that greps export output for `/_next/image` | 15 min |
| 5 | `sentry-test/server/route.ts` has `export const dynamic = "force-dynamic"` — build-fatal under export | trivial | Exclude from native build (web still wants it) | 10 min |
| 6 | `middleware.ts` is **silently dropped** — warns, does not fail | needs-work | Safe to drop: nothing server-side consumes the session, and `autoRefreshToken` is on client-side | 30 min + smoke test |
| 7 | ⚠️ **UNVERIFIED — the export-mode HEAD probe.** Under `output:'export'` Next fires `fetch(url,{method:'HEAD'})` before every route-cache fill and calls `rejectRouteCacheEntry` on non-2xx. Mechanism confirmed at `node_modules/next/dist/client/components/segment-cache/cache.js:855-867`. **Behavior through Capacitor's scheme handler is untested.** If HEAD fails, every navigation becomes a document load, unmounting `GameProvider` (`src/app/play/layout.tsx:5-7`) and destroying in-flight quiz state | **potentially hard** | Measure in Gate 0 on a real device | — |

Only 2 `<Image>` usages exist (`profile/page.tsx:155`, `BottomDock.tsx:64`); the logo is already a plain `<img>`.

---

## 2. Auth — the largest bounded porting cost

**Providers:** Google OAuth, Apple OAuth, and **anonymous sign-in as the default state**. Every visitor gets `signInAnonymously()` before they see a sign-in prompt (`src/lib/auth.ts:78`, called from `app/page.tsx:50` and `GameProvider.tsx:77`).

**Session storage: cookies.** `createBrowserClient` from `@supabase/ssr` with no options (`src/lib/supabase/client.ts:10`) → `document.cookie`. This is the problem: Capacitor's origin is `capacitor://localhost` (iOS) or `http://localhost` (Android), where custom-scheme cookie persistence in WKWebView is unreliable.

**Why that is worse than "users get logged out":** `ensureSession()` calls `signInAnonymously()` whenever no session is readable (`src/lib/auth.ts:78`). A storage read failure is indistinguishable from a first run — so a WebView that cannot persist cookies **mints a brand-new anonymous user on every cold start**, orphaning the previous account's streak, history and league memberships with no recovery path. This is silent permanent user-data loss, not an inconvenience.

**OAuth breaks in three independent ways on native:**

1. **Google blocks embedded WebViews.** `signInWithOAuth` is called without `skipBrowserRedirect` (`src/lib/auth/oauth.ts:44-47`), so supabase-js navigates the top-level document to `accounts.google.com`. Google returns `disallowed_useragent`. Needs `skipBrowserRedirect: true` + `@capacitor/browser` (ASWebAuthenticationSession / Chrome Custom Tabs).
2. **Redirect URL is derived from the origin.** `buildOAuthRedirect()` uses `window.location.origin` (`src/lib/auth/oauth.ts:113`) → `capacitor://localhost/auth/callback`, which cannot be registered with Google/Apple.
3. **The callback never mounts.** `/auth/callback` does all its work in a `useEffect` inside a page component (`src/app/auth/callback/page.tsx:14`). On native the callback arrives as an `appUrlOpen` deep-link event, not a page navigation — so `exchangeCodeForSession` (`:77`) never runs and sign-in hangs. **The callback body must be extracted into a framework-free async function** callable from both the web page and the native listener.

**The genuinely awkward one — anonymous upgrade has no native equivalent.** The anon→named upgrade uses `supabase.auth.linkIdentity()` (`src/lib/auth/oauth.ts:72-75`), which preserves the user id and therefore all scores, leagues and streaks. supabase-js has **no `linkIdentityWithIdToken`** — `linkIdentity` is redirect-only. Native sign-in plugins return an `id_token`, which only feeds `signInWithIdToken`, and that creates a *new* user. So native must keep an ASWebAuthenticationSession redirect flow specifically for the upgrade path, even if cold sign-in uses native buttons. **Budget for maintaining both mechanisms.**

**Pre-existing bugs found here (fix on web, independent of mobile):**
- The PKCE in-flight guard at `src/lib/auth.ts:63-74` scans `localStorage` for `pkce`/`code-verifier`/`sb-*-auth-token` keys. The client is cookie-backed, so those keys are never present — **the guard is dead code and the `'OAuth flow in progress'` throw is unreachable.** It will start firing (incorrectly, on every cold start) once storage moves to localStorage/Preferences. Rewrite it to key off an explicit flag.
- The link-failure recovery path rebuilds `redirectTo` as a hardcoded `${window.location.origin}/auth/callback` (`src/app/auth/callback/page.tsx:56`), **dropping the `?next=` param** that commit `5f8c7e8` added. A user who opens an invite link, signs in, and hits the already-linked branch lands on home instead of the invite. Two-line fix.
- `detectSessionInUrl` defaults to `true` and is never disabled, so the client auto-exchanges the PKCE code while `callback/page.tsx:77` also calls `exchangeCodeForSession` — a self-race masked by a `getSession()` re-check at `:84`. That masking assumption does not hold on native.
- Six exported functions in `src/lib/auth.ts` have zero callers (email `signUp`, `signInWithPassword`, `getCurrentUser`, `isAnonymousUser`, `upgradeToGoogle`, `upgradeToApple`). Delete before porting so the migration only reasons about live code.

**Auth guards are 100% client-side** (`src/app/admin/layout.tsx:13-24` is the only real one) and survive the port unchanged. Real enforcement is server-side in Edge Functions + RLS.

**Redirect allow-list is not in the repo.** `supabase/config.toml:32-33` has only localhost entries; production redirect URLs and all provider credentials live solely in the hosted Supabase dashboard. Adding native schemes is an untracked, unreviewable change.

---

## 3. Game lifecycle and what must become durable on-device

**Drop:** globally simultaneous, `11:30 UTC`, server-owned. `get-current-quiz/index.ts:25-32` selects the latest published quiz with `release_at_utc <= now()`; a pg_cron job runs `30 11 * * *`. No timezone term anywhere. Every player gets identical questions in identical order — no shuffling.

**Timer:** per-question, 12s, server-authoritative for scoring. The client sends only `{attempt_id, question_id, selected_answer_id}` — **no timing data is accepted**. Elapsed is computed server-side from `current_question_started_at`.

**There are two independent clocks, deliberately.** The client countdown is an absolute wall-clock `deadlineRef` polled by rAF (`play/q/[index]/page.tsx:170-186`). For Q1 it is set to `Date.now() + 12000` at mount *before* the server stamp exists, and the code explicitly refuses to adopt the server's expiry to avoid a visible jump (comment at `:116-124`). Net: **the server's window always starts one round-trip later than the UI's.** Native needs a single reconciled clock — measure the server offset once, apply it everywhere.

**Submission:** one POST per answer, no batching, plus an explicit finalize. Idempotent on `PRIMARY KEY (attempt_id, question_id)`. Answers cannot be changed — the server has already advanced `current_index`. Q1–Q9 navigate optimistically; Q10 awaits.

**Offline today: zero, and connectivity loss actively costs points.** No service worker, no manifest, no cached shell. When the network drops, the countdown keeps running normally (it is local), the submit `fetch` throws, and `withRetry` burns ~7s of exponential backoff — **every second of which is live server clock on the current question.** Past 12s the server converts it to a 0-point timeout. Retrying is never free in this design.

Commit `af86e61` ("Mid-quiz error recovery") added error *surfacing and containment* — a banner, optimistic-state rollback, a re-entry guard, staleness assertions. It stops the cascade. **It does not make an offline quiz completable**, and its recovery mechanism (manual retry) burns more server clock.

**What must become durable on-device** (all achievable without weakening the trust boundary):
- **Question payload** — `start-attempt` already returns all 10 questions in one response (`start-attempt/index.ts:262-266`). Cache them; the quiz then renders instantly and survives an app kill.
- **A real answer outbox** — persist `{attempt_id, question_id, selected_answer_id}` before the network call, drain on reconnect. Safe because `submit-answer` is already idempotent.
- **Attempt-state mirror** replacing the write-only `sessionStorage`.
- **A measured server-clock offset** driving one reconciled countdown.
- **App-lifecycle handlers** (background/foreground/online/offline) that re-reconcile on resume.
- **Cached last results + streak** so `/results` renders offline.

**Full offline play is not achievable** without handing the device the answer key, which abandons the anti-cheat posture the whole backend is built on. A defensible compromise is grace-window scoring (accept a queued answer whose *device* timestamp was in-window, capped at a few seconds), which requires a server change.

**`sessionStorage` is the wrong tier.** `quiz_id` and `quiz_questions` are written (`GameProvider.tsx:95-96`) and **never read back** — dead code. Only `attempt_state` is consumed, at `play/finalize/page.tsx:49`. And `sessionStorage` does not survive a WebView process kill, which on mobile is the *normal* case.

**No app-lifecycle handling exists at all** — zero `visibilitychange`, `pagehide`, `freeze`, `online`, or `offline` listeners. Backgrounding halts the rAF tick so no timeout fires while hidden; on foreground the timer snaps to 0 and the server records a 0-point timeout.

**Streaks never expire server-side.** `computeStreak` runs only at finalize (`finalize-attempt/index.ts:233`). A player who last played five days ago still reads `current_streak = 7` until their next finalize silently resets it. **The database cannot tell you a streak is dead** — which blocks the single highest-value native feature, streak-at-risk push notifications, until either a server expiry job or a client-side rule against a cached `last_quiz_date` exists.

---

## 4. Backend contract surface

**22 Edge Functions** (+ `_shared`), **zero Realtime**, **zero Storage buckets**, **one cron job**.

Realtime being unused removes the biggest Capacitor-vs-RN differentiator — there is no websocket lifecycle to manage across backgrounding. Avatars are hotlinked from the OAuth provider CDN, so there is no upload flow, file picker, or camera permission to port.

**Direct PostgREST reads from the browser** — 11 call sites, all SELECT-only, no client writes: `quiz_play_view`, `players`, `attempts`, `quizzes`, `question_tags`. Everything else goes through Edge Functions under service role.

### 🔴 The blocker outside `apps/web` that a frontend-only analysis misses

**`supabase/functions/_shared/cors.ts` emits a single static `Access-Control-Allow-Origin`** from `Deno.env.get("ALLOWED_ORIGIN")`, documented to be `https://play10q.com` in production. Capacitor sends `Origin: capacitor://localhost` (iOS) or `http://localhost` (Android). **One static header value cannot serve all three.**

Twelve functions import it — and they are exactly the game loop: `start-attempt`, `start-question-timer`, `submit-answer`, `finalize-attempt`, `resume-attempt`, `get-current-quiz`, `get-attempt-results`, `get-global-leaderboard`, `get-league-leaderboard`, `delete-attempt`, `create-quiz`, `publish-quiz`. The other ten hardcode `"*"` inline.

**So under Capacitor the app would half-work: leagues and profiles load, the quiz itself dies on every request.** That is the worst possible debugging shape. Fix: make `corsHeaders` a function taking `req`, echo the Origin when it matches an allow-list, add `Vary: Origin`. Touches all 12 call sites plus the 10 inline duplicates, then redeploy. **Prototype this before the client port, not after.**

### `openapi.yaml` is a trap — do not port it

It documents **5 of 22** functions. Every path is wrong (`/api/attempt/answer` vs `${SUPABASE_URL}/functions/v1/submit-answer`). The submit body names `selected_choice_id`; the server requires `selected_answer_id`. **A native client generated from this spec would 400 on every answer.** No `servers:` block, no `securitySchemes`.

The real contract is `apps/web/src/lib/api/edge-functions.ts:275-666` — every function, method, body shape, response type and `requireAuth` flag in one block. Delete or regenerate the YAML.

**Constants are forked three ways.** `supabase/functions/_shared/scoring.ts:1-5` says so explicitly ("duplicated here because Deno edge functions cannot import from the Node workspace packages"). Values currently agree; nothing enforces it. Adding a native client makes this a three-way manual sync — but since native reuses `packages/contracts`, it stays two-way in practice.

---

## 5. Frontend / mobile readiness

**Verdict: real mobile UX pass needed.** In mobile Safari today this is a good-looking, competently-built mobile *web page* — not something that passes for a native app. The visual layer is strong and needs almost no work; the app-shell layer is missing almost entirely. Estimate **1.5–3 weeks** on top of Capacitor plumbing.

**Already good — do not touch:** 420px phone column on every screen (`ArcadeBackground.tsx:9`); **zero** `sm:`/`md:`/`lg:` breakpoints anywhere (the app is mobile-only by construction, which is a gift here); 56px tap targets throughout; `active:` press states on every interactive element (the main reason it reads as game-like on touch); Tailwind v4 auto-wraps `hover:` in `@media (hover:hover)`; `prefers-reduced-motion` honored.

**P0 gaps:**
- **No `viewport` export at all** (`layout.tsx` has `metadata` only). No `viewport-fit=cover` → `env(safe-area-inset-*)` resolves to **0 on iOS**, so adding safe-area padding is a no-op until this lands first. Pinch-zoom is also enabled — you can two-finger zoom mid-timer.
- **Zero `env(safe-area-inset-*)` usage.** Concrete collisions: `Toast.tsx:47` and `invite/[code]/page.tsx:242` (`fixed bottom-*`, under the home indicator); `BottomDock` (overlaps home indicator); `AuthButton` at `absolute top-4 right-4` on `leaderboard/page.tsx:146` and `play/page.tsx:136` (under the notch).
- **`100vh` in 46 places, zero `dvh`.** Baked into `.bg-arcade` itself (`globals.css:74`), plus a nested double-`100vh` at `ArcadeBackground.tsx:9`. **This is a live bug in mobile Safari right now** — the `BottomDock` is pushed below the fold behind the URL bar.
- **Android hardware back is broken and traps the user.** Zero `router.back()` calls and zero `popstate` listeners repo-wide; every "back" affordance is a forward `router.push('/')`, so history only grows. Each quiz question is its own route, so a run leaves 10+ entries. Backing from `/play/q/5` pops to `/play/q/4`, and the corrective redirect at `play/q/[index]/page.tsx:57-71` **pushes** (not replaces), appending another entry — the user is bounced forward while the stack deepens, and back never escapes the quiz. Capacitor's default Android behavior makes this worse: with no `backButton` listener it walks WebView history and only exits when history is empty.

**High-value, low-cost native wins:**
- **`navigator.share` is not used** — "CHALLENGE YOUR FRIENDS" (`results/page.tsx:521-525`) silently copies to clipboard. `buildShareText()` already emits a Wordle-style emoji grid that is share-sheet-ready. `@capacitor/share` is ~10 lines.
- **No haptics anywhere.** `@capacitor/haptics` on the correct/wrong branches (`AnswerButton.tsx:112-133`) is ~5 lines and is one of the two most native-feeling moments in the game.
- **`PageTransition.tsx` is 117 lines of finished framer-motion with ZERO importers.** Route changes are instant hard swaps — the loudest "this is a website" tell in the app. Wiring up code that is already written is the best effort-to-perceived-nativeness ratio available.

**Other gaps:** `BottomDock` is on the home screen only — every other screen ends with a "GO HOME" button at the bottom of a scrolling page. No `aria-live` and no `role=` attributes anywhere (violates the project's own acceptance checklist at `.agent/skills/neo-brutalist-ui/SKILL.md:136`). All five modals lack `role="dialog"`/focus trap. The entire icon system is system emoji, which renders differently per platform and is un-brandable. No input has `autoCapitalize`/`autoCorrect`/`inputMode` — iOS will autocapitalize the handle field.

**Dead/broken styles found in passing:** `ErrorBoundary.tsx:40` uses `to-magentaA` (not a token → broken gradient on the crash screen); `Toast.tsx:54` uses `animate-slide-in` (undefined → no animation); `invite/[code]/page.tsx:242` uses `tailwindcss-animate` syntax but that package is not a dependency.

**PWA assets: essentially nothing.** `favicon.ico`, `icon.png`, `apple-touch-icon.png` via App Router conventions; `public/` holds one logo PNG. No manifest, no service worker, no `themeColor`, no maskable icon, no splash. Also: `twitter.card: "summary_large_image"` with **no `images` array** on either `openGraph` or `twitter` — daily-share link previews have no image, a real growth leak independent of the mobile decision.

**Fonts port cleanly.** `next/font/google` self-hosts Rubik + Bungee at build time under `_next/static/media`, so they ship inside the bundle and render offline.

---

## 6. Operations

**Only one environment exists: production.** No staging in Cloudflare (`wrangler.jsonc` has zero `[env.*]` blocks), none in Supabase (one project, migrations pushed by hand), none in Sentry (`environment: process.env.NODE_ENV` → always `production`), none in PostHog (one key; **local dev writes into the production project**).

**A mobile build needs somewhere that is not production to point a TestFlight / Play internal-track binary, and that place does not exist.** Standing it up is prerequisite work, it is not small (config is build-time-inlined, so it means a second build config and a second secret set), and **the cost is identical on both Capacitor and Expo** — do not attribute it to this decision.

**Supabase is not in CI at all.** Migrations and all 22 functions are deployed by hand. Tolerable when the client auto-updates on refresh; a real hazard once a store-reviewed binary can be weeks behind a contract change.

**`supabase/tests` (~85 tests including all RLS coverage) never runs.** It is not in the root `workspaces` array, and `npm test` is `npm run test --workspaces`. It is also stale — it asserts against `correct_answers` (dropped), `daily_results` (renamed), and asserts `anon cannot read players` which contradicts the live policy. **These tests would fail if anyone ran them.** This is how the security gaps in [03-blocking-fixes.md](03-blocking-fixes.md) survived.

**CI builds a different artifact than production ships.** `NEXT_PUBLIC_POSTHOG_KEY`/`HOST` are supplied only to the deploy job, not the CI build job (`ci.yml:36-44` vs `:74-88`). `NEXT_PUBLIC_*` is inlined at build time, so the artifact CI verifies has analytics compiled out.

**E2E coverage is 4 shallow assertions in 3 files**, none touching gameplay, sign-in, leagues or results. `auth.spec.ts` is a verbatim duplicate of the home-title assertion — there is no auth coverage. One project: Desktop Chrome. **No WebKit project, no mobile viewport** — precisely the two configurations Capacitor runs in.

**No versioning.** Zero git tags ever, no CHANGELOG, no release workflow. All three `package.json` files say `0.1.0` and never move. **Nothing stamps a build id anywhere the client, Sentry or PostHog can read it** — which is exactly what the store version tail requires.

**Support floor** is Next 16's default: Safari 16.4+ (≈ iOS 16.4, Mar 2023), Chrome 111+. Tailwind 4 agrees. Nothing here blocks Capacitor.

---

## 7. Analytics and error tracking as they stand

**PostHog** — `posthog-js` init is 4 lines (`src/lib/posthog.ts:17-20`), `capture_pageview: false`. **16 typed events**, all routed through a single `capture()` helper (`src/lib/analytics.ts:14-21`). Identity is the Supabase auth user id, set only for non-anonymous users; it survives the anon→OAuth upgrade because `linkIdentity` preserves the id.

**Autocapture is ON** (never overridden), as are UTM/referrer capture and rageclick detection. `capture_pageleave` defaults to `"if_capture_pageview"`, so with pageview capture off there are **no `$pageview` events at all** — `screen_view` is the only navigation signal. Zero feature flags, zero super properties.

**No platform dimension exists on any event.** See [06-observability.md](OBSERVABILITY.md) — the fix is ~5 lines and is identical work under Capacitor or Expo.

**Sentry** — three near-identical inits (client/server/edge) sharing one DSN. `tracesSampleRate: 0` everywhere and no Session Replay, so it is errors + structured logs only. **No `release` is set** and no `.sentryclirc`; the Next plugin auto-derives a git SHA. Server and edge configs are already near-dead weight and become fully dead under static export — client Sentry ports as-is.

**Push notifications: 100% greenfield.** No service worker, no manifest, no `Notification` API, no FCM/APNs/OneSignal, and no backend notification infrastructure (no device-token table, no sender). The nearest adjacent thing is `public.outbox_events`, an append-only domain-event table that nothing consumes — the natural future trigger source.

Because there is no existing investment, **this dimension is neutral between Capacitor and Expo**. It is, however, the strongest product argument for shipping a native shell at all.

---

## 8. UGC, social, and monetization

**The UGC surface is genuinely narrow — two fields.**

1. **Handle** (`players.handle_display`) — shape-constrained (`/^[a-zA-Z][a-zA-Z0-9]*$/`, 3–20 chars) but **not meaning-constrained**. `FuckYou42` validates cleanly and then appears on the global leaderboard to every player. Server-enforced in `update-handle`; **no profanity, blocklist or reserved-word list exists anywhere in the repo.**
2. **League name** — **truly unconstrained free text.** Server validation is length-only (≤100 chars), then inserted verbatim. Any Unicode, slurs, URLs pass. No rename path, no moderation tooling.

**Not present** (verified absent): comments, chat, DMs, posts, bios, league descriptions, user-submitted questions, uploaded images. Quiz content is admin-authored only.

**Avatars are OAuth-provider images only**, and are rendered **only for the viewing user's own account** — no other-user surface shows an avatar. So avatars carry no Guideline 1.2 moderation obligation.

**Two real social defects, both App-Review-relevant:**
- **You can be added to a league without consent.** `add-league-member` resolves any handle and inserts a membership row (`:81-122`). A stranger who reads your handle off the public leaderboard can pull you into a league with an arbitrary, unmoderated name.
- **And you cannot leave.** There is no leave-league endpoint anywhere in the client API surface. Only the owner can remove members. **The one durable user-to-user relationship in the app is non-consensual and non-exitable.**

**Privacy exposure:** `/u/[handle]` is served by `get-profile-by-handle`, which requires **no auth at all** and returns full history — streaks, all-time best/worst, accuracy, last 10 results, per-category performance — for any handle. Combined with `players_read_public USING (true)` (which dumps the entire user table including `linked_auth_user_id`), an attacker can enumerate every handle and harvest a behavioural profile for each. `get-league-by-invite` is likewise unauthenticated.

**Auto-generated handles leak identity:** `Player${userId.slice(0,8)}` (`start-attempt/index.ts:64`) puts the first 8 hex chars of the auth UUID on the public leaderboard. A `generateXboxStyleHandle` helper exists in `packages/contracts/src/handles.ts:31-38` with **zero callers** — wire it up.

**Monetization: none, and nothing planned.** No Stripe, no IAP, no ads, no paywall, zero related TODOs. **This materially favors the Capacitor wrap** — routing purchases through native IAP is the hardest part of wrapping a web app, and it simply does not apply. If a paid tier is ever added the calculus changes: web checkout inside a WebView is exactly the pattern Apple rejects.

**Account deletion does not exist** — see [03-blocking-fixes.md](03-blocking-fixes.md). Anonymous-by-default does **not** exempt us: the app creates accounts and persists data against them.

---

## 9. Documentation state

**No `CLAUDE.md` and no `AGENTS.md` existed** before this change. `.agent/skills/` (9 skills) was serving that role by convention only, with nothing pointing at it, and `.cursor/rules/` (22 `.mdc` files, used by Riley's IDE) is a parallel, older fork of the same guidance.

**Every file in `docs/` had zero inbound references** — not from the README, not from CI, not from any skill.

**Two contradictions ran through nearly every doc:** the deploy target (docs said Vercel/PM2/Cloudflare Pages; reality is Cloudflare **Workers** via OpenNext) and the question timer (docs said 16s; code says 12s).

**The most dangerous file was `.agent/skills/scoring-formula/SKILL.md`** — wrong time limit, wrong bonus window, every tier boundary off by one second, and a copy-pasteable code example reproducing the wrong formula. An agent following it writes scoring that silently disagrees with production. Corrected in this change.

See [../README.md](../../README.md) and the cleanup summary in the PR description for what was removed.
