# Testing Architecture

**Status:** proposed. Nothing in tiers 2, 4 or 5 exists today; tier 1 is partial and tier 3 is decorative.
**Scope:** how 10Q tests one product that ships to three release channels.

---

## The organizing principle

> **Do not build three test suites for one product.**
>
> Behavior is tested **once**, against the shared code that implements it. A platform-specific test exists only where the platforms *genuinely diverge* — a different runtime, a different OS API, a different distribution artifact. Everything else is one spec executed against more than one configuration.

This is not a style preference. It follows directly from [ADR-001](01-architecture-decision.md): there is **one** React codebase, and `apps/web` has essentially no server-rendering dependency. The scoring formula, the attempt state machine, the timer, the streak rules and the answer UI are literally the same modules on web, iOS and Android. Testing them three times does not test three things — it tests one thing three times and then rots in two places.

The corollary matters just as much: **the places that do diverge deserve real tests, and today have none.** WKWebView, a mobile viewport, the static export, push routing, cold-start session persistence. Those are the tests worth paying for.

### How to decide which tier a test belongs in

Ask: *what is the smallest thing that could be wrong here, and what is the cheapest runtime that can be wrong in that way?*

| If the bug can happen in… | …it belongs in | Times it is written |
|---|---|---|
| a pure function, no DOM | Tier 1 — shared logic | once |
| React state, props, effects, DOM | Tier 2 — component | once |
| a browser: routing, network, layout | Tier 3 — Playwright | once, run against N configurations |
| a browser engine specifically (WebKit vs Blink) | Tier 3 — one spec, extra project | once |
| the static export artifact only | Tier 3 — one spec, extra project | once |
| the OS: push, deep links, lifecycle, native sheets | Tier 4 — native shell | once per platform (they really differ) |
| only on real silicon, a real store binary, a real APNs/FCM path | Tier 5 — device E2E | once per platform, kept tiny |
| Postgres: RLS, grants, triggers, constraints | Backend tier | once |

**A test written at a higher tier than necessary is a bug.** It is slower, flakier, and it makes the failure harder to localize. Every time you are tempted to write a Playwright test for scoring, write a Tier 1 test instead.

---

## Where we actually are

Verified against the repo at `af86e61`.

| Tier | Exists? | Count | Where |
|---|---|---|---|
| 1 — shared logic / unit | Partial | 62 (`apps/web`) + 46 (`packages/contracts`) | `apps/web/src/lib/**/*.test.ts`, `packages/contracts/src/*.test.ts` |
| 1 — backend logic | Written, **never runs** | 69 pure + 16 RLS = 85 | `supabase/tests/` |
| 2 — component / UI | **Does not exist** | 0 | — |
| 3 — Playwright | Nominal | 4 tests, 3 files, 1 project | `apps/web/e2e/` |
| 4 — native shell | **Does not exist** | 0 | — |
| 5 — device E2E | **Does not exist** | 0 | — |

Specifics worth knowing before you touch anything:

- **`apps/web/vitest.config.ts:7`** sets `environment: "node"`. There is no jsdom, no `@testing-library/*`, and no `@vitejs/plugin-react` anywhere in the tree. A component test cannot run today even if you wrote one.
- **`apps/web/vitest.config.ts:8`** sets `include: ["src/**/*.test.ts"]`. A file named `AnswerButton.test.tsx` is **silently ignored** — no error, no warning, green CI. This is the single most likely way a first attempt at Tier 2 fails without anyone noticing.
- 42 React files have zero component coverage: 22 `page.tsx`/`layout.tsx` under `apps/web/src/app/`, 20 components under `apps/web/src/components/`. 38 of the 43 `.tsx` files carry `'use client'`.
- **`apps/web/e2e/auth.spec.ts:4-7`** is a verbatim copy of the home-title test in `home.spec.ts:4-7`. Despite the filename, **there is no auth coverage at all.**
- **`apps/web/playwright.config.ts:27-32`** defines exactly one project, `Desktop Chrome`. No webkit, no mobile viewport.
- **`apps/web/playwright.config.ts:36`** runs `npm run dev`. Playwright therefore tests a development React build with Strict Mode double-invoked effects, unminified code, and full middleware — never the artifact that ships. For a product whose core loop is an effect-driven `requestAnimationFrame` timer (`apps/web/src/app/play/q/[index]/page.tsx:164-186`), dev-vs-prod effect semantics are not a detail.
- **`.github/workflows/ci.yml:47`** installs only `chromium`. Adding a webkit project without changing this line produces a confusing runtime failure, not a skipped project.
- Vitest versions are split: `apps/web` resolves **4.0.18** (nested), `packages/contracts` and `supabase/tests` fall through to the hoisted root **1.6.1**. Config APIs differ between these majors — notably `environmentMatchGlobs` (v1) vs `test.projects` (v4).

---

## Tier 1 — Shared logic and unit tests

**What it is:** pure functions, no DOM, no network, no database. Milliseconds per test. Runs on every save and every PR.

**Belongs here:**

| Subject | Source of truth | Test location |
|---|---|---|
| Scoring formula and bonus tiers | `packages/contracts/src/scoring.ts` | `packages/contracts/src/scoring.test.ts` ✅ exists |
| Handle validation and generation | `packages/contracts/src/handles.ts` | `packages/contracts/src/handles.test.ts` ✅ exists |
| Constants | `packages/contracts/src/constants.ts` | parity test — **missing**, see below |
| Attempt state machine | `supabase/functions/_shared/attempt-state.ts` | `supabase/tests/unit/attempt-state.test.ts` ⚠️ exists, never runs |
| Streak computation | `supabase/functions/_shared/streak.ts` | `supabase/tests/unit/streak.test.ts` ⚠️ exists, never runs |
| Bearer-token / auth core | `supabase/functions/_shared/auth-core.ts` | `supabase/tests/unit/auth-core.test.ts` ⚠️ exists, never runs |
| Countdown to next quiz release | `apps/web/src/lib/time.ts` | **missing** — write it |
| API error normalization | `apps/web/src/lib/error-handling.ts` | `apps/web/src/lib/error-handling.test.ts` ✅ exists |
| Analytics event shape | `apps/web/src/lib/analytics.ts` | `apps/web/src/lib/analytics.test.ts` ✅ exists |

**Does NOT belong here:**

- Anything that renders. That is Tier 2, even if it feels like a unit.
- Anything that asserts on a Supabase response shape by mocking `fetch` at the module boundary and then asserting the mock. `apps/web/src/lib/api/edge-functions.test.ts` is close to this line; a mock-shaped test proves the client parses what you told it to send, not what the server sends. The real contract check is the backend tier.
- Anything requiring a database. RLS is not a unit test.

### The duplicated-constants problem, and the test that must fail CI on drift

`packages/contracts` is described in the repo as the single source of truth. It is not. Edge Functions run under Deno and cannot import Node workspace packages, so `supabase/functions/_shared/` holds a hand-maintained copy — and the copy says so in its own header (`supabase/functions/_shared/scoring.ts:1-5`: *"If you change one, change the other."*).

There are in fact **three** copies of some values, because individual functions redeclare them locally:

| Constant | `packages/contracts/src/constants.ts` | `supabase/functions/_shared/` | Function-local |
|---|---|---|---|
| `QUESTION_TIME_LIMIT_MS` | `:6` = 12000 | `scoring.ts:11` = 12000 | — |
| `BONUS_WINDOW_MS` | `:7` = 11000 | `scoring.ts:10` = 11000 | — |
| `BASE_POINTS_CORRECT` | `:8` = 5 | `scoring.ts:7` = 5 | — |
| `MAX_BONUS_POINTS` | `:10` = 5 | `scoring.ts:9` = 5 | — |
| `MAX_QUESTIONS_PER_QUIZ` | `:13` = 10 | `attempt-state.ts:24` = 10 | `publish-quiz/index.ts:12` = 10 |
| `CHOICES_PER_QUESTION` | `:14` = 4 | — | `publish-quiz/index.ts:13` = 4 |
| **`MIN_TAGS_PER_QUESTION`** | **`:15` = 1** | — | **`publish-quiz/index.ts:14` = 0** ❌ |
| `ErrorCodes` (15 keys) | `errors.ts:7-38` | `response.ts:8-24` | — |

The last row is live drift — it is [03-blocking-fixes.md](03-blocking-fixes.md) **C8**, open since the MVP. Separately, `supabase/functions/submit-answer/index.ts:201` references `ErrorCodes.INVALID_ANSWER`, which exists in **neither** definition, so the anti-cheat rejection ships `{ code: undefined }` (**C5**).

Nothing enforces agreement. Add a parity suite that does.

**Where it goes:** `supabase/tests/parity/`. That directory already has a vitest config with `resolve.extensions` configured for Deno-style `.ts` import specifiers (`supabase/tests/vitest.config.ts:9-13`), which is exactly what importing `_shared/*.ts` from Node requires. Extend the `include` array at `supabase/tests/vitest.config.ts:7`:

```ts
include: ["./*.test.ts", "./unit/**/*.test.ts", "./parity/**/*.test.ts"],
```

**What it asserts.** Constant equality is the weak version — it passes while the *behavior* diverges. Assert behavior over a swept domain:

```ts
// supabase/tests/parity/scoring.parity.test.ts
import { describe, expect, it } from "vitest";
import * as contracts from "../../../packages/contracts/src/scoring";
import * as contractsConst from "../../../packages/contracts/src/constants";
import * as edge from "../../functions/_shared/scoring.ts";

const SHARED = [
  "BASE_POINTS_CORRECT", "BASE_POINTS_INCORRECT",
  "MAX_BONUS_POINTS", "BONUS_WINDOW_MS", "QUESTION_TIME_LIMIT_MS",
] as const;

describe("contracts <-> edge _shared parity", () => {
  it.each(SHARED)("%s agrees", (k) => {
    expect(edge[k]).toBe(contractsConst[k]);
  });

  // Behavioural parity, not constant parity: sweep the entire input domain.
  it("calculateBonus agrees on every millisecond in [-1000, 13000]", () => {
    for (let ms = -1000; ms <= 13000; ms++) {
      expect(edge.calculateBonus(ms)).toBe(contracts.calculateBonus(ms));
    }
  });

  it("calculateQuestionScore agrees across the full cross product", () => {
    const boundaries = [-1, 0, 2999, 3000, 4999, 5000, 6999, 7000,
                        8999, 9000, 10999, 11000, 11999, 12000, 99999];
    for (const isCorrect of [true, false])
      for (const isTimeout of [true, false])
        for (const ms of boundaries) {
          const a = contracts.calculateQuestionScore(isCorrect, ms, isTimeout);
          const b = edge.calculateQuestionScore(isCorrect, ms, isTimeout);
          expect([b.basePoints, b.bonusPoints, b.totalPoints, b.elapsedMs])
            .toEqual([a.basePoints, a.bonusPoints, a.totalPoints, a.elapsedMs]);
        }
  });
});
```

Note the two implementations return *different-shaped* objects — `packages/contracts/src/scoring.ts:17-24` includes `isCorrect`/`isTimeout` fields that `supabase/functions/_shared/scoring.ts:13-18` does not. Compare the four numeric fields explicitly rather than deep-equalling the objects, or the test fails for a reason nobody cares about.

Two more parity tests, both cheap and both catching live bugs:

```ts
// supabase/tests/parity/error-codes.parity.test.ts
// 1. The two ErrorCodes objects must have identical key sets.
// 2. Every `ErrorCodes.X` referenced anywhere under supabase/functions/
//    must exist in the object — this catches C5 (ErrorCodes.INVALID_ANSWER
//    at submit-answer/index.ts:201, defined nowhere, shipping `undefined`).

// supabase/tests/parity/no-local-redeclare.parity.test.ts
// Scan supabase/functions/*/index.ts for local `const <SHARED_NAME> = ...`
// declarations of any name exported by packages/contracts/src/constants.ts,
// and fail with the file, line and both values. This catches C8
// (MIN_TAGS_PER_QUESTION: contracts 1, publish-quiz/index.ts:14 zero).
```

**These tests will fail on the first run.** That is the point — C5 and C8 are open. Fix the drift in the same PR that adds the tests, then the suite holds the line.

> **Why not just delete the duplication?** Because Deno cannot resolve `@10q/contracts` from a Node workspace. A build step that generates `_shared/constants.ts` from `packages/contracts` is the real fix, and it is worth doing later. Until then, an enforced parity test is what converts an honest comment into an enforced invariant. Do not let "we should really unify these" block adding the test — the test is the cheap 80%.

### What Tier 1 cannot tell you

That the *database* agrees with the code. `enforce_question_timing()` overwrites the Edge Function's computed expiry with `+ INTERVAL '16 seconds'` (`supabase/migrations/20250119000000_notion_schema_alignment.sql:396-410`) while every code path uses 12000ms — [03-blocking-fixes.md](03-blocking-fixes.md) **C1**. A perfect parity suite between `contracts` and `_shared` still reports green. Only the backend tier catches that class, and the backend tier does not run.

---

## Tier 2 — Component tests for the shared React layer

**This tier does not exist and is the largest gap in the repo.** It is also the tier with the best return, because it is where "one codebase, three platforms" actually pays: a component test written once covers web, iOS and Android, and runs in ~10ms.

### Setup

`apps/web` resolves vitest **4.0.18**, so use `test.projects` (v4) rather than the v1 `environmentMatchGlobs`. Two environments in one config, because flipping the whole config to jsdom would change the behavior of existing tests — `apps/web/src/lib/analytics.ts:15` early-returns on `typeof window === 'undefined'`, so the 24 tests in `analytics.test.ts` currently exercise the no-op path and would start hitting `posthog.capture` under jsdom.

```ts
// apps/web/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const alias = {
  "@": path.resolve(__dirname, "./src"),
  "@10q/contracts": path.resolve(__dirname, "../../packages/contracts/src"),
};

export default defineConfig({
  test: {
    projects: [
      {
        // Pure lib modules keep the node environment they were written for.
        test: { name: "lib", environment: "node", globals: true,
                include: ["src/lib/**/*.test.ts"] },
        resolve: { alias },
      },
      {
        // Everything that renders.
        plugins: [react()],
        test: { name: "ui", environment: "jsdom", globals: true,
                setupFiles: ["./vitest.setup.ts"],
                include: ["src/{components,app,platform}/**/*.test.{ts,tsx}"] },
        resolve: { alias },
      },
    ],
  },
});
```

> The existing alias at `apps/web/vitest.config.ts:13` points at `"../packages/contracts/src"`, which resolves to `apps/packages/contracts/src` — one `../` short. It has never been exercised because the only `@10q/contracts` imports reachable from the current test files are `import type` (`apps/web/src/lib/error-handling.ts:5`, `apps/web/src/lib/api/edge-functions.ts:2`), which the transform erases. The moment a Tier 2 test renders `TutorialModal.tsx:23`, `HandleNudgeModal.tsx:4` or `settings/page.tsx:9` — all of which import `validateHandle` as a **value** — it will fail to resolve. Fix it to `../../packages/contracts/src` before writing the first component test.

Dev dependencies to add to `apps/web`: `jsdom`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. `apps/web/tsconfig.json` already sets `"jsx": "react-jsx"`, so no JSX config work is needed.

`apps/web/vitest.setup.ts` must at minimum: import `@testing-library/jest-dom/vitest`; stub `next/navigation` (`useRouter`, `useSearchParams`, `usePathname`); stub `@/lib/posthog`; and stub `framer-motion` to plain elements so animation does not fight fake timers.

**File convention:** colocate. `apps/web/src/components/AnswerButton.test.tsx` next to `AnswerButton.tsx`. Do not create a parallel `__tests__` tree — the point of this tier is that the test is obviously attached to the unit.

### What to write, in priority order

**1. `GameProvider` — the state machine (`apps/web/src/components/GameProvider.tsx`).**
It is a `useSyncExternalStore` store with five phases (`:10-15`: `idle | loading | ready | playing | error`) and a `prepare()` pipeline that chains `ensureSession` → `getCurrentQuiz` → `startAttempt` → questions (`:29`). This is the highest-value target in the repo: every failure mode of the prep pipeline is a phase transition, and every one of them is testable in a jsdom render with the three domain modules mocked.

Assert: `idle → loading → ready` on the happy path; each dependency failing puts the store in `error` with the message surfaced (not swallowed); `prepare()` called twice concurrently does not double-start an attempt; `setAttempt` (`:31`) emits to subscribers; unmount unsubscribes. **This is the component whose remount destroys in-flight quiz state** under the Gate-0 HEAD-probe failure mode described in [ADR-001](01-architecture-decision.md#gate-0--prove-it-before-building-anything-native) — a test that pins its lifecycle contract is directly load-bearing for the migration.

**2. `AnswerButton` correct/wrong (`apps/web/src/components/AnswerButton.tsx`).**
The `AnswerFeedback` union is `'idle' | 'committed' | 'correct' | 'wrong'` (`:5`) and drives background and text color through a branch ladder (`:31-39`). Assert each of the four states renders its intended affordance, that `disabled` suppresses `onClick`, and that `dimmed` and `isSelected` compose. Use accessible roles and text, not Tailwind class names — asserting `bg-green` couples the test to the design system and it will churn.

**3. The timer countdown (`apps/web/src/app/play/q/[index]/page.tsx:96-186`).**
The most important behavior in the product and currently untested at every tier. It is a wall-clock design: an absolute deadline in `deadlineRef` (`:37`, `:136`), polled by a single `requestAnimationFrame` loop deriving remaining time from `Date.now()` (`:176-184`). Test with `vi.useFakeTimers()` plus a stubbed `requestAnimationFrame`, and assert:

- `attempt.current_question_expires_at` present → deadline is exactly that instant (`:135-136`).
- `attempt.current_question_expires_at` absent → falls back to `now + 12000` and fires `start-question-timer` (`:106-123`). **After C1 lands this must be 12000 on both sides**; today the DB persists 16s and this test is the tripwire that keeps the client from silently re-adopting it.
- Advancing the clock past the deadline drives `timeRemaining` to exactly 0, once, and does not go negative (`:178`).
- The low-time threshold flips at ≤3000ms (`:468`).
- A late server response does **not** move a deadline already set at mount (`:116-123`).

**4. Modals — `TutorialModal` (292 lines), `SignInModal` (113), `HandleNudgeModal`.**
First-run onboarding shipped in `af86e61` and is completely uncovered. Assert step advance/back, that dismissal persists via `apps/web/src/lib/tutorial.ts`, that it shows once and not again, and that focus is trapped and Escape closes. The a11y assertions are not optional politeness — they are what makes the same component behave on a mobile screen reader.

**5. The mid-quiz error-recovery paths from `af86e61`.**
This commit exists *because* a swallowed `submit-answer` failure cascaded into a partial attempt and a broken results page. Every mechanism it added is currently unprotected:

| Mechanism | Location | Assert |
|---|---|---|
| Synchronous re-entry guard | `submittingRef`, `page.tsx:42`, `:195`, `:212`, `:298`, `:317` | two clicks in one React batch fire exactly one `submitAnswer` — `isSubmitting` is state and cannot guard this alone |
| Staleness assertion | `page.tsx:197-210`, `:300-316` | when route index, `currentQuestion.order_index` and `attempt.current_index` disagree, **no** request is sent and `trackAppError` fires with `location: 'timeout_stale_question'` |
| Error banner | `page.tsx:449-462` | a rejected submit renders the code and message, and Dismiss clears it |
| Optimistic rollback | `page.tsx:348-372` | on failure: `submittingRef` released, selection cleared, feedback `idle`, store reset to `current_index: questionIndex`, and `router.replace('/play/q/N')` back to the failed question — not forward |
| Timeout submit | `page.tsx:215-230` | records `answer_id: null` in analytics — and see **C2**, the timeout currently sends `answers[0].answer_id` on the wire, which can score 5 points for a question nobody answered |

Write the C2 test to the *intended* behavior (explicit timeout signal) as part of fixing C2, not to today's behavior.

**6. `ErrorBoundary` (`apps/web/src/components/ErrorBoundary.tsx`).** A child that throws renders the fallback and reports to Sentry once, not per re-render.

**7. `HUD`, `QuestionCard`, `LeaderboardTable`, `BottomDock`.** Rendering-shape tests. Low value each, cheap in bulk, and they are the safety net for the safe-area / `100vh` work in Phase 5.

**8. The platform seam, once it exists.** When `apps/web/src/platform/` lands ([04-shared-code-architecture.md](04-shared-code-architecture.md#the-platform-seam)), every capability gets a **fake** implementation used by Tier 2 tests, and the interface in `types.ts` gets a conformance suite both the web and native implementations must pass. This is how one component test covers three platforms: the component talks to the interface, and the interface is verified separately per implementation. Particularly: `storage`'s `StorageResult<T>` discriminated union, where `ok: false` must **never** be treated as "no session, create one" — the failure mode that silently mints a new anonymous user on every cold start.

### Does NOT belong in Tier 2

- Real network. Mock at the domain-module boundary (`@/domains/attempt`, `@/domains/quiz`), not at `fetch`.
- Real navigation. Assert that `router.push` was called with the right path; do not assert that the page changed.
- Visual regression / screenshot diffing. jsdom has no layout engine. If you want pixels, that is Tier 3.
- Anything about WebKit, safe areas, or viewport. jsdom is not a browser.

---

## Tier 3 — Playwright: web plus shared behavioral coverage

**What it is:** a real browser engine, real navigation, real network to a real backend. This is where "shared behavior across configurations" is proved, and it is the tier that most directly de-risks the Capacitor decision.

Today: 4 tests asserting a page title, the presence of a link, and the word "leaderboard". Zero gameplay. Zero auth. One browser. One viewport.

### Restructure the directory by *sharedness*, not by feature

```
apps/web/e2e/
  shared/          runs in every project — chromium, webkit, mobile-webkit, mobile-chrome, export
    gameplay.spec.ts
    auth.spec.ts
    leaderboard.spec.ts
    league.spec.ts
    profile.spec.ts
  web-only/        runs only against the dev/prod server projects
    middleware.spec.ts        session refresh + Cache-Control: no-store
    dynamic-routes.spec.ts    /invite/[code], /u/[handle], /leagues/[id] path form
    redirects.spec.ts         the permanent /invite/<code> redirect from Phase 3
  export-only/     runs only against the static-export project
    export-shape.spec.ts      no /_next/image, trailingSlash, cold boot at depth
  fixtures/
    test-user.ts   deterministic account provisioning
    quiz.ts        deterministic quiz fixture
```

`e2e/shared/` is the whole point: **one spec file, five executions.** Do not fork a spec because a selector differs on mobile — fix the selector.

### The four projects to add

```ts
// apps/web/playwright.config.ts
const WEB = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000';
const EXPORT = 'http://localhost:4321';

projects: [
  { name: 'chromium',      use: { ...devices['Desktop Chrome'], baseURL: WEB },
    testIgnore: /export-only/ },

  // WKWebView is WebKit. Capacitor's iOS runtime is WKWebView.
  { name: 'webkit',        use: { ...devices['Desktop Safari'], baseURL: WEB },
    testIgnore: /export-only/ },

  // Capacitor's iOS viewport is a phone viewport.
  { name: 'mobile-webkit', use: { ...devices['iPhone 15'], baseURL: WEB },
    testIgnore: /export-only/ },

  // Capacitor's Android runtime is Chromium in a phone viewport.
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'], baseURL: WEB },
    testIgnore: /export-only/ },

  // The artifact the native builds actually ship.
  { name: 'export',        use: { ...devices['iPhone 15'], baseURL: EXPORT },
    testIgnore: /web-only/ },
],

webServer: [
  { command: 'npm run start', url: WEB,    reuseExistingServer: !process.env.CI, timeout: 120_000 },
  { command: 'npx serve out -l 4321', url: EXPORT, reuseExistingServer: !process.env.CI, timeout: 120_000 },
],
```

Four things to get right:

1. **`.github/workflows/ci.yml:47` installs only chromium.** Change it to `npx playwright install --with-deps chromium webkit`. Without this the webkit projects fail with a missing-executable error that reads like a config bug.
2. **Stop testing the dev server.** `apps/web/playwright.config.ts:36` runs `npm run dev`. Next's App Router runs React Strict Mode in development, which double-invokes effects — and the quiz page is effect-driven (`page.tsx:96`, `:171`, `:192`). A timer or re-entry bug that only manifests under single-invocation production semantics is invisible today, and a bug that only manifests under double-invocation is a false alarm. Use `npm run start` against a production build, which is also what CI already built at `ci.yml:36`.
3. **The static-export project needs the native build first.** Phase 3 of [05-migration-plan.md](05-migration-plan.md#phase-3--static-export-compatibility) adds `scripts/build-native.sh`; the export project's `webServer` serves the `out/` directory it produces. Until that script exists, this project cannot be enabled — sequence it with Phase 3, not before.
4. **Tag, don't fork.** For the small number of assertions that legitimately differ, use Playwright test tags rather than duplicate files: `test('refreshes the session cookie', { tag: '@web-only' }, …)`. `@playwright/test@1.57` supports tags in the test options object.

### Why the export project is not optional

Under `output: 'export'` the artifact loses, by construction: `middleware.ts` (session refresh **and** the `Cache-Control: no-store` header at `apps/web/src/middleware.ts:34`), dynamic routes without `generateStaticParams`, rewrites/redirects/headers, and `next/image` with the default loader. `apps/web/next.config.ts:9-16` currently configures `images.remotePatterns` for Google and Apple avatars — under export those must become `unoptimized` or a custom loader, or avatars 404 on device.

**Without a project that serves `out/`, every one of those divergences ships unverified against a green CI badge.** CI would build the export, never exercise it, and report success. The export project is the cheapest possible early warning, and it runs on Linux in seconds.

Be precise about what it does **not** prove. Serving `out/` over HTTP is not Capacitor. A plain static server answers `HEAD` correctly; the iOS `WKURLSchemeHandler` and Android `WebViewAssetLoader` may not, and that specific divergence is what destroys `GameProvider` state between questions. That measurement belongs to Gate 0 and Tier 5. The export project catches *artifact-shape* bugs, not *WebView-runtime* bugs. Say so in the spec file header so nobody over-trusts it.

### What to actually test at Tier 3

Real gameplay, which currently has zero coverage:

- **Full 10-question run to results.** Start an attempt, answer all ten, land on `/results`, score matches the sum of the per-question scores.
- **The timer expires.** Wait out a question without answering; assert the timeout path and that the score for that question is 0. (This is the Tier 3 counterpart of the Tier 2 timer test — here it proves the *server* agrees.)
- **Resume mid-quiz.** Reload the page at `/play/q/5` and assert the same question, the same server deadline, and no fresh 12s window. This is [03-blocking-fixes.md](03-blocking-fixes.md) **C3**, and on mobile resume is the common path, not the rare one.
- **Submit failure surfaces and rolls back.** Route-intercept `submit-answer` to a 400 and assert the banner (`page.tsx:449-462`) and the rollback to the same question.
- **Auth, for real.** Anonymous session created on first visit; it survives reload; handle can be set; sign-in modal opens. OAuth redirect itself is Tier 5.
- **Leaderboard and league flows**, including the invite-link path — the growth loop, and the route shape that has to change under export.

`webkit` earns its slot on this codebase specifically: `apps/web/src/app/play/q/[index]/page.tsx:135` does `new Date(attempt.current_question_expires_at).getTime()`. Safari's `Date` parser is stricter than V8's about non-ISO-8601 strings and returns `NaN` where Chrome succeeds. `NaN` here means a deadline of `NaN` and a timer that never counts down. A single webkit run finds that class of bug for free.

### Determinism: the hard part

10Q is a *daily* game. A test that plays "today's quiz" is a test whose behavior depends on the calendar, on whether a quiz was published, and on whether this account already used its one daily attempt. `getNextQuizReleaseAt` (`apps/web/src/lib/time.ts:29-40`) puts the boundary at 11:30 UTC, so a suite that is green at 11:00 fails at 11:35.

Requirements, in order:

1. **A fresh account per test run.** `supabase.auth.signInAnonymously()` mints one; capture the id in a fixture and let the run own it. Never share an account between parallel workers — the attempt is per-player-per-day and workers will collide.
2. **A known quiz.** Seed a deterministic quiz into the local stack. **`supabase/seed.sql` does not exist.** What does exist is `scripts/create-test-quiz.ts` — a service-role script that inserts a quiz with 10 questions, 4 choices each, tags and known correct answers, released at the next 11:30 UTC. Use it as the *starting point*, not the destination: it is imperative, it falls back to `NEXT_PUBLIC_SUPABASE_URL` when `SUPABASE_URL` is unset (`:15-16`) — which in any normal local shell means production — and it is not deterministic across runs. Port its question set into `supabase/tests/seed/` as fixed SQL with stable UUIDs so both the RLS suite and Playwright can assert exact scores.
3. **Never against production.** See the backend section: this is exactly the mistake `supabase/tests/rls-smoke.test.ts:10-11` already makes.

> **Also orphaned:** `scripts/test-phase1.ts`, `scripts/test-phase2.ts` and `scripts/test-full-lifecycle.ts` are named like tests but are manual `tsx` scripts with no assertions a runner can collect, and `scripts/` is not in the root `workspaces` array either (it sits at the repo root, outside `apps/*` and `packages/*`, with its own lockfile). Treat them as documentation of the intended happy path — `test-full-lifecycle.ts` in particular is a useful specification for the Tier 3 gameplay spec — then delete them once real coverage exists, so nobody mistakes them for a safety net.

> **DECISION REQUIRED — Tier 3 backend target.** Point Playwright at (a) a local `supabase start` stack in CI, (b) the staging Supabase project from Phase 2, or (c) both, with the local stack on PRs and staging pre-release. (a) is faster and hermetic; (c) also proves the deployed function fleet. Recommendation: **(c)**, defaulting to local. Whatever you pick, **not production** — `ci.yml:52-54` currently hands the E2E step the production Supabase URL and anon key.

---

## Tier 4 — Native shell integration

**What it is:** the things Playwright genuinely cannot reach, because they are not in the browser. Runs on simulators and emulators, in CI, but not on every PR.

Nothing here exists yet; nothing here can exist before Phase 5 produces a Capacitor project.

### The surface

| Surface | Why Playwright cannot | How to test |
|---|---|---|
| Push routing and tap-to-open | No notification center, no APNs/FCM | Inject a payload, tap it, assert the landed route |
| Deep links / Universal Links / App Links | No OS URL dispatch, no AASA/assetlinks verification | Fire an OS intent/openurl, assert the app foregrounds on the right screen |
| Lifecycle and backgrounding mid-quiz | Browser tab visibility ≠ WebView process suspension | Home → wait → resume; assert timer and attempt state |
| Cold-start session persistence | localStorage in a browser ≠ Preferences on a custom-scheme origin | Force-stop, relaunch, assert the *same* player id |
| Haptics | No API | Assert the capability call at Tier 2; feel it once at Tier 5 |
| Native share sheet | No API | Assert the sheet presents; assert payload at Tier 2 |
| OAuth via `ASWebAuthenticationSession` / Custom Tabs | Out-of-process system UI | Mostly manual — see below |
| Offline and resume | Browser offline ≠ device radio state | Android automatable; iOS mostly manual |

### Tooling recommendation: Maestro, with eyes open

**Recommend [Maestro](https://maestro.mobile.dev) as the primary Tier 4/5 driver.** Flows are YAML, one flow runs on both iOS and Android, it handles deep links natively (`openLink`), and it drives the Capacitor WebView through accessibility so you address elements by visible text.

Honest trade-offs:

- **Selectors are text-based and brittle.** Maestro sees the WebView through the accessibility tree, not the DOM. Renaming a button breaks a flow. Mitigate by keeping Tier 4 flows *few* and *structural* — Maestro proves "the app got to the results screen", not "the results screen shows the right bonus". The latter is Tier 2/3.
- **No native push-payload injection.** You drive push with platform CLIs alongside Maestro, not inside it.
- **Limited assertion vocabulary.** Visible/not-visible and simple regexes. Anything richer belongs a tier down.

Alternatives, and why not:

| Tool | Verdict |
|---|---|
| **Appium** | Works, and can switch into the WebView context for CSS selectors — genuinely more powerful. Cost: a WebDriver server, driver/OS version matrices, and materially more maintenance. Adopt only if Maestro's selector fragility becomes the actual bottleneck. |
| **XCUITest + Espresso** | Native-fidelity, per-platform, two languages, two suites. Exactly the "three suites for one product" outcome this document exists to prevent. Reserve for genuinely platform-specific assertions no cross-platform tool can express. |
| **Detox** | Built around React Native's synchronization model. Poor fit for a Capacitor WebView. Skip. |
| **Capacitor plugin unit tests** | Not a substitute — they test the plugin, not your routing. |

### The commands that make each surface testable

Push, iOS simulator — a real end-to-end of the *routing*, without APNs:

```bash
cat > /tmp/daily.apns <<'JSON'
{ "Simulator Target Bundle": "<DECISION REQUIRED: bundle id>",
  "aps": { "alert": { "title": "Today's 10Q is live", "body": "10 questions. 12 seconds each." },
           "sound": "default" },
  "route": "/play" }
JSON
xcrun simctl push booted <DECISION REQUIRED: bundle id> /tmp/daily.apns
```

Android emulator — deliver through FCM if you want the real path, or drive the intent directly for routing-only:

```bash
adb shell am broadcast -a com.google.android.c2dm.intent.RECEIVE \
  -n <DECISION REQUIRED: package>/com.google.firebase.messaging.FirebaseMessagingService \
  --es route "/play"
```

Deep links:

```bash
# iOS — a Universal Link routes to the app only if the associated-domain
# entitlement is present AND the AASA at play10q.com is reachable. That is
# precisely what this test proves.
xcrun simctl openurl booted "https://play10q.com/invite?code=TESTCODE"

# Android App Links
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://play10q.com/invite?code=TESTCODE"
```

Lifecycle and cold start:

```bash
# iOS
xcrun simctl terminate booted <bundle id> && xcrun simctl launch booted <bundle id>
# Android
adb shell am force-stop <package> && adb shell monkey -p <package> 1
# Background without killing (Maestro): pressKey Home; wait; launchApp
```

Offline:

```bash
# Android — scriptable
adb shell svc wifi disable && adb shell svc data disable
# iOS simulator — no scriptable radio toggle. Use Network Link Conditioner
# (100% Loss profile) on the host, or accept that iOS offline is a Tier 5
# manual check. Do not pretend it is automated.
```

### The honest limits

- **OAuth cannot be meaningfully automated.** `ASWebAuthenticationSession` and Chrome Custom Tabs present out-of-process system UI; Google actively blocks embedded WebViews with `disallowed_useragent`, which is the whole reason [04-shared-code-architecture.md](04-shared-code-architecture.md#oauth--the-one-place-two-mechanisms-are-unavoidable) requires the native plugin. Automating it means either automating Google's login page (fragile, and it will trip bot detection) or stubbing the provider. **Recommendation:** stub an email-OTP provider on staging so the *callback and session-exchange* half is automated, and keep the real Google/Apple sheet as a Tier 5 human check on every release candidate. Say plainly in the runbook that this step is manual.
- **Haptics have no assertion.** Assert `haptics.impact()` was called with the right style at Tier 2 against the fake capability. Feel it on a device once per release.
- **Share sheet content is not readable on iOS.** Assert presentation only.
- **A simulator is not a device.** WebView memory pressure, real network variability and store-signed entitlements are Tier 5.

### Where these live

```
apps/mobile/e2e/
  flows/
    push-tap-routing.yaml
    deep-link-invite.yaml
    lifecycle-background-midquiz.yaml
    cold-start-session.yaml
    share-sheet.yaml
  scripts/
    push-ios.sh  push-android.sh  offline-android.sh
```

`apps/mobile/` is the Capacitor workspace package from [04-shared-code-architecture.md](04-shared-code-architecture.md); the Capacitor CLI roots itself at `process.cwd()`, so its config, `ios/`, `android/` and its tests all live together.

---

## Tier 5 — True-device end-to-end

**Deliberately small. Target: 8 journeys, no more.** Every one runs on real hardware, on a store-signed (or store-equivalent) binary, against a real backend. They are slow, expensive, and the only place certain truths are observable.

The bar for a slot: **the failure it catches cannot occur — or cannot be observed — one tier down.** A journey that a simulator could run belongs at Tier 4.

| # | Journey | Why real hardware, and not a tier down |
|---|---|---|
| 1 | Install → cold start → play → force-quit → relaunch **three times**, then reinstall. Assert the same player id, streak and history throughout. | The failure is *silent*: on a custom-scheme origin where cookies are unreliable, a storage read failure is indistinguishable from a first run and `ensureSession()` mints a brand-new anonymous user, orphaning the account. jsdom has real `localStorage`; a simulator has a clean WebView. Only a real device under real cache eviction reproduces it. This is the single highest-value test in the document. |
| 2 | Full 10-question run on device, timing the client countdown against the server's recorded `time_ms`. | The 12s wall-clock timer is the product. On device it meets rAF throttling under WKWebView, real RTT, and thermal/low-power state. And the cost of being wrong is asymmetric: the player gets **one attempt per day**, so a mid-quiz stall is not a retry — it burns the day. |
| 3 | Google sign-in **and** Apple sign-in through the real system sheet, then the anonymous → named upgrade via `linkIdentity`. | The system auth sheet is out-of-process and unautomatable (Tier 4 above). Google returns `disallowed_useragent` in an embedded WebView, so this is precisely the path no lower tier exercises. Reviewers also perform it manually — Apple expects the native `AuthenticationServices` sheet, not a web redirect. |
| 4 | Push while backgrounded → tap → app opens on today's quiz with a live attempt. Then repeat from a **cold** (force-quit) state. | Cold-start tap routing is a different code path from warm-start: the payload arrives before the WebView exists. Real APNs/FCM also exercises entitlements, provisioning profile and token registration, none of which a simulator payload injection touches. |
| 5 | Universal Link / App Link from an external app (Messages) into an invite, for a signed-out user, ending in joined-the-league. | Association is a *server plus signing-key* fact: the AASA at `play10q.com/.well-known/apple-app-site-association` must match the shipped entitlement, and `assetlinks.json` must carry the **Play App Signing** key fingerprint, not the upload key. A simulator `openurl` proves none of that. This is also the growth loop. |
| 6 | Background mid-question for 60s, return, and resume. | WebView process suspension is the normal mobile interruption, not an edge case. It exercises `resume-attempt`, whose live bug (**C3** — resume returns `question_started_at` while the client reads `current_question_started_at`, so timings are always `undefined` and the player gets a fresh 12s window on an already-running clock) is exactly this class. |
| 7 | Android hardware back throughout the quiz and at each modal. | An OS gesture with no browser equivalent. Currently unhandled and it actively traps the user inside the quiz ([ADR-001](01-architecture-decision.md#honest-scope-correction)). Emulator back is close, but gesture-navigation devices behave differently from three-button devices — run it on both. |
| 8 | Account deletion end-to-end on a real signed-in account, including the owned-league resolution. | A hard store gate (Apple 5.1.1(v), [03-blocking-fixes.md](03-blocking-fixes.md) **B1**) that a reviewer *will* perform by hand. It is irreversible and cascades across `attempts`, `daily_scores`, `leagues.owner_player_id` and `league_members`, so it is worth proving on the real binary before a reviewer proves it for you. |

Journeys 1, 2, 6 and 7 are automatable with Maestro. Journeys 3, 4, 5 and 8 have manual steps; write them as a **signed checklist in the release runbook**, not as aspirational automation that quietly never runs.

**Device matrix — keep it to four.** One current iPhone, one oldest-supported iPhone (Capacitor 8 targets iOS 15.0 minimum), one current Pixel, one low-end Android. The low-end Android is not optional: WebView performance on cheap hardware is the named revisit-the-ADR trigger.

> **DECISION REQUIRED — device farm.** Options: BrowserStack App Automate / Sauce Labs (per-minute, broad matrix, works with Maestro), Firebase Test Lab (cheap for Android, no iOS Universal Links story), or a shelf of physical devices in the office (cheapest at this scale, no CI integration, needs a human). At 10Q's current size a **shelf plus a per-release checklist** is defensible and honest; a farm becomes worth it when Tier 5 runs more than weekly.

---

## The backend test gap

**This is the largest and cheapest-to-close hole in the repo.**

`supabase/tests/` contains 85 tests: 16 RLS tests in `rls-smoke.test.ts` and 69 pure unit tests across `unit/attempt-state.test.ts` (25), `unit/scoring.test.ts` (16), `unit/streak.test.ts` (16) and `unit/auth-core.test.ts` (12).

**None of them have ever run in CI.** The root `package.json:5-8` declares `workspaces: ["apps/*", "packages/*"]`. `supabase/tests` is in neither glob, so `npm test` — which is `npm run test --workspaces` (`package.json:13`) — never reaches it, and `.github/workflows/ci.yml:33-34` invokes exactly that.

Three separate problems, all of which must be fixed together:

**1. It is not in CI.** Add `"supabase/tests"` to the root `workspaces` array. Two knock-on effects to expect: `supabase/tests/package-lock.json` becomes dead and should be deleted (workspaces share the root lockfile), and the package will start resolving the root's hoisted vitest. Today `apps/web` runs vitest **4.0.18** from its own nested install while `packages/contracts` and `supabase/tests` fall through to root **1.6.1**. Bring all three to v4 in the same PR, or the parity suite's config will not behave as documented.

**2. It hardcodes production.** `supabase/tests/rls-smoke.test.ts:10-11`:

```ts
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zcvwamziybpslpavjljw.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOi…";
```

Anyone who runs `npm test` in that directory without env vars runs the RLS suite **against the live production database**. Some of those tests write. Delete the defaults entirely and fail loudly:

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Run against a local stack: supabase start`);
  return v;
}
const SUPABASE_URL = required("SUPABASE_URL");
```

Add a second guard that refuses to run if the URL is not `localhost`/`127.0.0.1` unless `ALLOW_REMOTE_DB=1` is explicitly set. The production URL and anon JWT are already in git history; rotating the anon key is a separate decision for [03-blocking-fixes.md](03-blocking-fixes.md), but stopping the tests from *using* it is free.

**3. It is stale — it would fail today.** It asserts against a schema that no longer exists:

| Assertion | Location | Reality |
|---|---|---|
| `from("correct_answers")` | `rls-smoke.test.ts:26`, `:39` | table dropped |
| `from("daily_results")` | `rls-smoke.test.ts:79` | renamed to `daily_scores` |
| `toHaveProperty("choice_text")` | `rls-smoke.test.ts:104` | column is `answer_body` |
| "anon cannot read players table directly" | `rls-smoke.test.ts:136` | **contradicts the live policy** — `players_read_public FOR SELECT USING (true)` |

That last one is the tell. The test encodes the intent (`players` should not be world-readable) while the database does the opposite — [03-blocking-fixes.md](03-blocking-fixes.md) **A4**. A test suite that would have caught a live security defect, disabled, for months. Several other assertions expect an `ERROR` where RLS actually returns an empty set, which is a correct-but-different outcome and must be rewritten, not deleted.

### This gap is exactly how the security issues survived

[03-blocking-fixes.md](03-blocking-fixes.md) is explicit: **A1** (`delete-attempt` is a total leaderboard bypass, gated only by a client-side `if (!isAdmin)` at `apps/web/src/app/page.tsx:128`) and **A2** (`publish-quiz` is an unauthenticated service-role write) both survived because the project's stated shipping gate — *"tests that prove invariants are enforced"* — was written and then never wired up.

The lesson is structural, not moral: **a test suite that does not run in CI is worse than no test suite**, because it produces the belief that the invariant is covered. Deleting `supabase/tests` would have been more honest than leaving it.

### The target shape

Split the suite by whether it needs Postgres, so the pure two-thirds can run on every PR while the DB third runs only when it must:

```jsonc
// supabase/tests/package.json
"scripts": {
  "test":    "npm run test:unit",                          // default: no Docker needed
  "test:unit": "vitest run ./unit ./parity",               // pure, ~1s
  "test:db":   "vitest run ./rls ./integration"            // needs `supabase start`
}
```

```
supabase/tests/
  unit/          existing 69 pure tests — fix imports, keep
  parity/        NEW — the contracts ↔ _shared drift tests from Tier 1
  rls/           REWRITTEN from rls-smoke.test.ts, against a local stack
  integration/   NEW — Edge Functions served locally, exercised over HTTP
  seed/          NEW — deterministic fixtures, also used by Playwright
```

**RLS tests that must exist**, each mapping to a named finding:

| Test | Guards |
|---|---|
| `anon` cannot read `question_answers.is_correct` | **A6** — answer secrecy rests on one untested column GRANT (`20260310100000_restrict_is_correct_column.sql:5-8`) |
| `authenticated` cannot read `is_correct` either | A6 |
| `anon` reading `players` returns only the five public columns | **A4** — currently returns every column including `linked_auth_user_id` |
| A user cannot read another user's `attempts` or `attempt_answers` | attempt isolation |
| `delete-attempt` rejects a non-admin caller | **A1** |
| `publish-quiz` rejects an unauthenticated caller | **A2** |
| `start-question-timer` is rejected/clamped when it arrives long after `attempts.started_at` | **A3** |
| The persisted `current_question_expires_at` is `started_at + 12s` | **C1** — the trigger currently forces 16s, and no other tier can see it |
| `attempt_answers.time_ms` CHECK upper bound is 12000 | C1 |

The C1 test is the clearest argument for this tier existing at all. Perfect agreement between `packages/contracts` and `supabase/functions/_shared` still reports green while the database silently overwrites both.

**Prerequisite: `supabase/seed.sql` does not exist.** Deterministic fixtures — a known quiz with known correct answers, two players, one league — have to be written before either the RLS tests or Playwright can be reliable. Build it once, in `supabase/tests/seed/`, and use it from both. `scripts/create-test-quiz.ts` already encodes the right question/choice/tag shape and is the fastest way to get there; convert it to fixed SQL with stable UUIDs rather than starting from the schema.

> **DECISION REQUIRED — CI stack strategy.** `supabase start` in GitHub Actions pulls Docker images and takes roughly 2–4 minutes. Options: (a) run it on every PR, (b) run it on PRs that touch `supabase/**` via a `paths` filter plus always on `main`, (c) use Supabase branch databases. Recommendation: **(b)** — it keeps the median PR fast without letting a schema change merge unverified.

---

## Release gates

Each row is the minimum bar for one state transition. Mechanics of each transition live in [release/RELEASE_ARCHITECTURE.md](release/RELEASE_ARCHITECTURE.md); this table says what must be *green* for it to happen.

**Remember the standing rule from [ADR-001](01-architecture-decision.md): one codebase does not mean one deployment channel.** Web, iOS and Android release independently and do not go public simultaneously. Every gate below assumes clients and backend tolerate version skew.

### Web

| # | Transition | Minimum test bar | Blocking |
|---|---|---|---|
| W1 | PR → mergeable to `main` | Lint, typecheck, Tier 1 (all workspaces incl. `supabase/tests` unit + parity), Tier 2, Tier 3 `chromium` + `webkit` + `mobile-webkit`, both builds (web + export) succeed | Yes |
| W2 | `main` → Worker version uploaded (`wrangler versions upload`) | W1, plus Tier 3 `export` project, plus backend `test:db` against a local stack | Yes |
| W3 | Version → serving 100% (`wrangler versions deploy <id>@100%`) | Smoke suite green against the version's preview URL (or against the version at 0% via the `Cloudflare-Workers-Version-Overrides` header) | Yes |
| W4 | Post-deploy | Smoke suite against `play10q.com`; Sentry error rate flat for 15 min | No — triggers rollback, does not block |

### iOS

| # | Transition | Minimum test bar | Blocking |
|---|---|---|---|
| I1 | Source → uploadable build | W1, plus the native export build, plus `npx cap sync ios` clean. **Built with Xcode 26+ / iOS 26 SDK** — mandatory since 28 Apr 2026; a miss is rejected at upload, before review | Yes |
| I2 | Build → TestFlight **internal** (≤100 testers, no review) | I1, plus Tier 4 flows green on an iOS 26 simulator | Yes |
| I3 | Build → TestFlight **external** (requires TestFlight App Review) | I2, plus Tier 5 journeys 1–3 on a physical iPhone. Budget for review: max 6 submissions per 24h, one build per version in review at a time, and an external group requires an internal group to exist first | Yes |
| I4 | Version → App Review submission | I3, plus Tier 5 journeys 4–8, plus the store-compliance checklist in [STORE_READINESS.md](STORE_READINESS.md) — account deletion (**B1**) and the four UGC mechanisms (**B2**) are hard blockers. Age-rating questionnaire answered; EU trader status verified; a **reviewer demo account** provided | Yes |
| I5 | Approved → released (optionally phased) | Tier 5 journeys 1, 2 and 4 on the exact build being released | Yes |
| I6 | Phased release day 1→7 | Sentry crash-free rate ≥ threshold, sliced by `client_platform: ios` and `app_build` ([OBSERVABILITY.md](OBSERVABILITY.md)) | Pauses the phase |

Two things not to believe about I6. Phased release is **updates only** — never a first release. And it is **not a traffic gate**: anyone can manually download the new build on day 1, so it throttles only the silent auto-update push. Do not use it as a backend-compatibility rollout control; use the minimum-supported-version gate from Phase 2 for that.

### Android

| # | Transition | Minimum test bar | Blocking |
|---|---|---|---|
| A1 | Source → AAB | W1, plus the native export build, plus `npx cap sync android` clean. Target **API 36 (Android 16)** — required for all new apps and updates from 31 Aug 2026 | Yes |
| A2 | AAB → **internal** track (minutes, usually no review) | A1, plus Tier 4 flows green on an Android 16 emulator | Yes |
| A3 | → **closed** track (standard review, up to 7 days) | A2, plus Tier 5 journeys 1, 2, 5 and 7 on physical Android — including one low-end device | Yes |
| A4 | → **production** | A3, plus Tier 5 journeys 4, 6 and 8, plus Data safety declaration verified against actual SDK network behavior (PostHog, Sentry, Supabase), plus the account-deletion **web URL** live and reachable without the app | Yes |
| A5 | Staged rollout percentage increases | Sentry crash-free rate and PostHog completion rate sliced by `client_platform: android` and `app_build` | Halts the rollout |

Three Play-specific facts that shape the schedule more than any test does:

- **The 12-tester / 14-day gate.** A personal Play Console account created after 13 Nov 2023 must run a closed test with **12 testers opted in continuously for 14 consecutive days**, then apply for production access and pass a written human review. That is a multi-week calendar item, not an engineering task. Start it the day the first closed-track build is installable. Organization accounts are exempt. **DECISION REQUIRED: is the 10Q Play account personal or organization?**
- **First production release cannot be staged or halted.** Staged rollout is updates-only, and you cannot halt a first release because there is no previous version to fall back to. A5 does not exist for v1.0.0.
- **An outstanding release blocks the next one.** A stuck partial rollout will block CI's next publish attempt with an error that reads like an auth failure.

### The gate that applies to all three

**Do not ship a client change that assumes the backend changed at the same moment, or vice versa.** A store binary can lag a backend deploy by weeks. Any PR touching an Edge Function contract needs a test proving the *previous* client shape still works — this is the version-skew obligation from [ADR-001](01-architecture-decision.md), and it belongs in `supabase/tests/integration/` as an explicit "old client, new server" case.

---

## CI topology

Realistic budget. macOS runners bill at 10× Linux; real-device minutes are worse. The design principle: **everything hermetic and fast runs on every PR; everything slow, flaky or expensive runs on a schedule or on demand.**

| Trigger | What runs | Runner | Target wall-clock |
|---|---|---|---|
| **Every PR** | Lint, typecheck, Tier 1 (all workspaces), parity suite, Tier 2, web build, native export build, Tier 3 `chromium` + `webkit` + `mobile-webkit` + `export` | `ubuntu-latest` | **≤ 10 min** |
| **PR touching `supabase/**`** | The above, plus `supabase start` and backend `test:db` | `ubuntu-latest` | ≤ 15 min |
| **Push to `main`** | Everything above unconditionally, then upload the Worker version, smoke it, promote to 100%, smoke production | `ubuntu-latest` | ≤ 20 min |
| **Nightly (`schedule`)** | Tier 4 on an iOS 26 simulator and an Android 16 emulator; full Tier 3 matrix including `mobile-chrome`; backend `test:db` | `macos-latest` (iOS) + `ubuntu-latest` (Android) | ≤ 45 min |
| **Pre-release (tag / `workflow_dispatch`)** | Everything, plus store artifacts, plus Tier 5 automated journeys 1, 2, 6, 7 | `macos-latest` | ≤ 90 min |
| **Release candidate (manual)** | Tier 5 manual journeys 3, 4, 5, 8 — signed checklist by a human | Physical devices | Hours, human-paced |

Non-negotiables:

- **Tier 5 never runs on a PR.** Not once. A device suite on a PR is a queue, a bill, and a flake source, and it will be disabled within a month.
- **Tier 4 never runs on a PR either** — it needs a macOS runner for iOS. Nightly plus pre-release is the right cadence.
- **The nightly job must page someone.** A scheduled job whose failures nobody sees is the `supabase/tests` mistake with extra steps.
- **Keep `forbidOnly: !!process.env.CI`** (`apps/web/playwright.config.ts:11`). Already correct.
- **Reconsider `retries: 2`** (`:13`). Retries hide flake; with a real gameplay suite you want flake visible. Prefer `retries: 1` plus `trace: 'retain-on-failure'`.

### Workflow layout

One `ci.yml` is already at its limit. Split:

```
.github/workflows/
  ci.yml           PR + main: lint, typecheck, tier 1, tier 2, builds, tier 3
  backend.yml      paths: supabase/** → supabase start + test:db; also on main
  deploy-web.yml   main only: upload version → smoke → promote → smoke prod
  native.yml       nightly + workflow_dispatch: tier 4 on simulators/emulators
  release.yml      tag: build store artifacts, tier 5 automated journeys
```

---

## The CI defect: verifying a different artifact than production ships

`.github/workflows/ci.yml` builds the app twice, with different environments.

The `ci` job's build step (`:36-44`) receives `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.

The `deploy` job's build-and-deploy step (`:78-88`) receives all of those **plus** `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.

`NEXT_PUBLIC_*` values are **inlined at build time**. So:

- Every test in CI runs against a bundle where PostHog is unconfigured. The analytics layer that all 16 typed events flow through (`apps/web/src/lib/analytics.ts:14-21`) is dead code in every artifact CI has ever tested.
- The bundle production serves is built in a *different job*, on a *different runner*, and is never tested at all.
- **An analytics change that throws in production will pass CI**, because `capture()` swallows errors (`:18-20`) and PostHog was never initialized in the tested build anyway.

**The minimum fix** — add the two PostHog secrets to the `ci` job's build env — closes the divergence but still builds twice. Two builds of the same SHA on two runners are not guaranteed identical.

**The real fix: build once, test that artifact, ship that artifact.** `npm run deploy` in `apps/web` is `opennextjs-cloudflare build && opennextjs-cloudflare deploy`, and the two halves are separable:

```yaml
# ci job
- name: Build
  run: npx opennextjs-cloudflare build
  working-directory: apps/web
  env:
    # the complete production environment, defined ONCE in one place
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
    NEXT_PUBLIC_SENTRY_DSN: ${{ secrets.NEXT_PUBLIC_SENTRY_DSN }}
    NEXT_PUBLIC_POSTHOG_KEY: ${{ secrets.NEXT_PUBLIC_POSTHOG_KEY }}
    NEXT_PUBLIC_POSTHOG_HOST: ${{ secrets.NEXT_PUBLIC_POSTHOG_HOST }}
    SENTRY_ORG: 10q-1z
    SENTRY_PROJECT: javascript-nextjs
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}

- uses: actions/upload-artifact@v4
  with: { name: open-next, path: apps/web/.open-next }

# deploy job
- uses: actions/download-artifact@v4
  with: { name: open-next, path: apps/web/.open-next }
- run: npx opennextjs-cloudflare deploy    # no rebuild
```

This makes "CI verifies the artifact production ships" literally true, and it is a **prerequisite** for the upload-then-promote release flow in [release/RELEASE_ARCHITECTURE.md](release/RELEASE_ARCHITECTURE.md) — you cannot smoke-test a specific Worker version and then promote *that version* if the deploy step rebuilds a different one.

A related defect in the same file: the E2E step (`:49-54`) runs **after** the build but starts its own `npm run dev` server (`apps/web/playwright.config.ts:36`), so the built artifact is never exercised by the E2E suite either. Switching the `webServer` command to `npm run start` closes both halves of the problem.

One more, from a security angle: `ci.yml:52-54` hands the E2E step the **production** Supabase URL and anon key. Every CI run, including from a fork PR if the workflow ever permits it, plays against the live database. Repoint it at a local stack — the same fix the backend section requires.

---

## What to write first

Everything above cannot be built at once. This order is chosen so that each step either closes a hole that is currently *hiding* a known defect, or unblocks the next step.

1. **Delete the production defaults in `supabase/tests/rls-smoke.test.ts:10-11`** and add the localhost guard. One commit, no dependencies, removes the risk that anyone running the suite writes to production.
2. **Add `supabase/tests` to the root `workspaces` array** (`package.json:5-8`), split its scripts into `test:unit` / `test:db`, and unify vitest on v4. `test:unit` (69 pure tests) is green immediately and joins every PR. `test:db` stays out of CI until step 4.
3. **Write the parity suite** (`supabase/tests/parity/`), fix **C8** and **C5** in the same PR. This is the cheapest possible enforcement of "one source of truth" and it fails CI on drift from day one.
4. **Rewrite the RLS suite** against a local stack, write `supabase/tests/seed/`, and add the `backend.yml` workflow with a `paths` filter. Include the A4, A6 and C1 assertions explicitly. **This is the step that would have caught A1 and A2.**
5. **Fix the CI env drift** — build once, upload the artifact, deploy that artifact. Cheap, and it stops CI from testing a bundle production never ships.
6. **Stand up Tier 2**: jsdom project, testing-library, `vitest.setup.ts`, and the *first* three test files — `GameProvider`, `AnswerButton`, and the timer. Do not attempt broad coverage in this PR; prove the harness with the three highest-value components.
7. **Add the `webkit` and `mobile-webkit` Playwright projects** and fix `ci.yml:47` to install webkit. Point `webServer` at `npm run start` instead of `npm run dev`. Cheap, and it converts the central assumption of the Capacitor decision into a measurement — this is the probe [ADR-001](01-architecture-decision.md#gate-0--prove-it-before-building-anything-native) explicitly recommends running during Gate 0.
8. **Write real gameplay E2E** in `e2e/shared/`: full run, timeout, resume, submit-failure rollback. Requires the deterministic fixtures from step 4.
9. **Finish Tier 2** — modals, the error-recovery paths from `af86e61`, `ErrorBoundary`, the remaining components. Bulk work, parallelizable, low risk.
10. **Add the `export` Playwright project**, alongside Phase 3's `scripts/build-native.sh`. Not before — there is no `out/` to serve until then.
11. **Tier 4 (Maestro flows + push/deep-link scripts)**, alongside Phase 5's Capacitor shell.
12. **Tier 5 journeys and the manual checklist**, alongside Phase 9's release machinery.

Steps 1–5 are worth doing **now**, independent of any mobile work. They are web defects and web risk. Steps 6–8 pay for themselves immediately on web and again on every platform afterward.

---

## DECISION REQUIRED — open items

| # | Decision | Blocks | Notes |
|---|---|---|---|
| D1 | Bundle identifier and Android package name | Tier 4 entirely | Every `xcrun simctl` / `adb` command in this document takes it as an argument. Also blocks AASA, assetlinks, push registration. |
| D2 | Tier 3 backend target: local stack, staging, or both | Step 8 | Recommendation: both, local by default. **Never production** — `ci.yml:52-54` currently uses production. |
| D3 | `supabase start` on every PR, or `paths`-filtered | Step 4 | Recommendation: `paths` filter on PRs, unconditional on `main`. |
| D4 | Device-farm vendor vs. a physical device shelf | Tier 5 | Recommendation: shelf plus a per-release checklist until Tier 5 runs more than weekly. |
| D5 | Play Console account type — **personal or organization** | Android gate A3 | A personal account created after 13 Nov 2023 must clear the 12-tester / 14-day closed-test gate before it can ever reach production. Multi-week calendar impact. Find out before scheduling. |
| D6 | Apple Team ID and signing identity | Tier 4/5 on iOS | Needs a human with the Apple Developer account. Long lead time — start early per [05-migration-plan.md](05-migration-plan.md#phase-9--release-machinery-and-first-submission). |
| D7 | How OAuth gets a partially-automated path | Tier 4 | Recommendation: stub an email-OTP provider on staging to cover the callback/session-exchange half; keep the real Google/Apple sheet as a manual Tier 5 step. |
| D8 | Whether Tier 3 runs against staging on a schedule | CI topology | Depends on staging existing at all — see [05-migration-plan.md](05-migration-plan.md#phase-2--foundations). |
| D9 | Whether to generate `supabase/functions/_shared/constants.ts` from `packages/contracts` at build time | Nothing — the parity test is the interim fix | The permanent fix for the duplication. Do not let it block step 3. |

**Hand-offs that need a human, not an agent:** D5 (log into Play Console and check), D6 (Apple Developer enrolment, certificates, provisioning profiles), the Tier 5 manual journeys, and the physical devices themselves. An agent can write every flow, script and assertion in this document; it cannot accept a license agreement, hold an iPhone, or answer Google's production-access questionnaire.

---

## Related

- [01-architecture-decision.md](01-architecture-decision.md) — why Capacitor; Gate 0, which the webkit/mobile Playwright projects directly serve
- [02-current-state.md](02-current-state.md) — the audit these numbers come from
- [03-blocking-fixes.md](03-blocking-fixes.md) — A1–A7, B1–B6, C1–C10; the backend tier exists to guard these
- [04-shared-code-architecture.md](04-shared-code-architecture.md) — the platform seam that makes one component test cover three platforms
- [05-migration-plan.md](05-migration-plan.md) — which phase each tier lands in
- [OBSERVABILITY.md](OBSERVABILITY.md) — the five identifiers the release gates read
- [STORE_READINESS.md](STORE_READINESS.md) — the compliance half of gates I4 and A4
- [release/RELEASE_ARCHITECTURE.md](release/RELEASE_ARCHITECTURE.md) — the state transitions this document gates
