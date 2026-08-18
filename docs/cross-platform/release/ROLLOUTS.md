# Rollouts — Promotion Policy

**This doc is the decision rules.** When do you advance a release, how long do you wait, what makes you stop, and how do you coordinate three channels that do not go public at the same time.

**It is not the mechanics.** Commands, console navigation and per-platform gotchas live in:

- [WEB.md](WEB.md) — Cloudflare Workers versions, upload/promote, rollback
- [IOS.md](IOS.md) — TestFlight, App Store Connect, phased release
- [ANDROID.md](ANDROID.md) — Play tracks, staged rollout, Managed Publishing
- [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) — the channel model and version-skew contract
- [VERSIONING.md](VERSIONING.md) — where `app_version` / `app_build` come from
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — the identifiers this gate queries on

The governing rule from [ADR-001](../01-architecture-decision.md): **one codebase does not mean one deployment channel.** Web, iOS and Android are three independently controllable channels. Every rule below exists because they drift apart in production, permanently.

---

## 0. This gate is not runnable today

Everything in §2 queries identifiers that do not exist in the repo yet. Do not write the gate script before the prerequisites land — you will be writing filters against fields that are always `undefined`.

| Prerequisite | Status today | Owner |
|---|---|---|
| `release_sha`, `client_platform`, `app_version`, `app_build`, `environment` in PostHog + Sentry | **None exist.** No version file, zero git tags, all three `package.json` files pinned at `0.1.0` | [VERSIONING.md](VERSIONING.md), [../OBSERVABILITY.md](../OBSERVABILITY.md) |
| Sentry `release` + `dist` | Never set. `apps/web/instrumentation-client.ts:3-13` sets neither | [../OBSERVABILITY.md](../OBSERVABILITY.md) |
| Sentry `environment` distinguishes anything | `process.env.NODE_ENV` → always `production` (`instrumentation-client.ts:6`) | [../OBSERVABILITY.md](../OBSERVABILITY.md) |
| PostHog super properties | `posthog.init()` at `apps/web/src/lib/posthog.ts:17-20` registers none | [../OBSERVABILITY.md](../OBSERVABILITY.md) |
| A non-production environment to soak in | **Does not exist** — one Cloudflare Worker, one Supabase project, one Sentry project, one PostHog key | Phase 2, [../05-migration-plan.md](../05-migration-plan.md) |
| CI and deploy build the same artifact | They do not. `NEXT_PUBLIC_POSTHOG_KEY/HOST` are given to the deploy job (`.github/workflows/ci.yml:85-86`) but not the CI build job (`:38-44`), and `NEXT_PUBLIC_*` is inlined at build time | Phase 2 |

### Three PostHog signals the gate needs and cannot currently compute

These are not aspirational metrics. They are gaps in `apps/web/src/lib/analytics.ts` that make three of the four PostHog gate signals unqueryable. Fix them as typed wrappers in `analytics.ts` — never by calling `posthog.capture()` from a component, per [../OBSERVABILITY.md](../OBSERVABILITY.md).

| Gap | Evidence | Fix |
|---|---|---|
| **`sign_in` fires before the redirect, not after it.** It is an *intent* event. `oauth.ts:161` and `:170` both call `trackSignIn` immediately before `signInWithOAuthOrReport`. Nothing fires on successful return from the callback | `apps/web/src/lib/auth/oauth.ts:161,170` | Add `sign_in_succeeded` on session establishment after callback. Only then is auth success rate a ratio rather than a count of button presses |
| **OAuth start failures never reach PostHog.** `captureOAuthStartFailure` (`oauth.ts:166,173`) reports to Sentry only | `apps/web/src/lib/auth/oauth.ts:166,173` | Add `sign_in_failed` with a `reason` property, alongside the Sentry report |
| **Error codes are embedded in a free-text string.** `trackAppError` takes only `{ location, message }` (`analytics.ts:183-188`), and the quiz path formats the code into the message: `` `${code}: ${message}` `` | `analytics.ts:183-188`; `play/q/[index]/page.tsx:244-245,353-354` | Promote `code` to its own property. Without it you cannot group submit failures by error code in PostHog, only string-match |

Answer-submit error rate **is** computable today, because the two submit failure paths use stable `location` values — `question_submit` (`play/q/[index]/page.tsx:353`) and `timeout_submit` (`:244`). Use those exact strings.

**Until the identifiers land, the interim gate is:** deploy web, watch the unfiltered Sentry issue stream and the PostHog completion funnel for one hour spanning a quiz drop, roll back on anything new. That is not a gate, it is a vigil. Do not ship a store binary against it — a store binary is the case where you cannot roll back, which is exactly when a real gate earns its cost.

---

## 1. Default rollout shape per platform

| | **Web** | **iOS** | **Android** |
|---|---|---|---|
| **Shape** | Upload version → smoke on the version's preview URL → promote to **100% in one step** | Internal TestFlight → external TestFlight → App Store with **phased release** (1/2/5/10/20/50/100 over 7 days) | Internal → closed → production **staged rollout** at 5 → 20 → 50 → 100% |
| **Traffic split during rollout?** | **No — deliberately none** | **No.** Phased release throttles only the silent auto-update push | **Yes.** A real fraction of eligible devices |
| **Time to full** | Minutes | 7+ days after approval | 4–7 days after approval |
| **Rollback** | One command, seconds | **None.** Pause phasing, or ship a new build through review | Halt (stops distribution; does not downgrade), or ship a higher `versionCode` |
| **Gate direction** | Gates on the way **out** — the lever is rollback | Gates on the way **in** — the lever is not advancing | Gates on the way **in** |
| **First release** | Same as any release | **Phased release unavailable** — updates only | **Staged rollout unavailable** — first production release goes to 100%, and cannot be halted |

### Why web does not use a traffic split

Cloudflare supports gradual deployments (`wrangler versions deploy <id>@10% <id>@90%`), and 10Q could use them. **Do not.** Five reasons, in descending weight:

1. **A Worker split cannot canary the thing that breaks the game.** All game authority — `start-attempt`, `start-question-timer`, `submit-answer`, `finalize-attempt`, scoring, the 12s server clock — lives in the 22 Supabase Edge Functions, deployed on a completely separate pipeline that no Worker percentage touches. A split canaries asset serving, SSR/RSC output, and the session-refresh middleware: the parts least likely to silently corrupt game state.
2. **A split *creates* an incident class.** Cloudflare routes each request independently with no stickiness. HTML from version A can request `/_next/static/chunks/*` hashes that only exist in version B → 404. Cloudflare documents this exact scenario and calls affinity "particularly important" for content-hashed assets. For a game with a hard 12s per-question timer, a mid-quiz chunk 404 is not a retry — **it burns the user's one daily attempt.**
3. **Concurrent versions fight over auth cookies.** `apps/web/src/middleware.ts:30` refreshes the Supabase session and writes cookies on every non-asset request. Two versions serving the same browser alternately — especially across a `@supabase/ssr` upgrade or a cookie-name change — can each rewrite the other's cookies. That risk scales with how long two versions coexist, which a slow rollout maximizes.
4. **The canary signal is weak at this traffic shape.** A daily trivia game concentrates traffic in a spike around the 11:30 UTC drop. Off-peak, 5% of traffic is too few requests to be statistically meaningful before you would promote anyway.
5. **Rollback here is genuinely cheap.** The Worker's only binding is `ASSETS` (`apps/web/wrangler.jsonc:6-9`) — no KV, D1, R2 or Durable Objects, so none of Cloudflare's documented rollback blockers apply. The version snapshot includes the static assets, so a rollback restores a self-consistent code+asset pair. And `middleware.ts:34` already sets `Cache-Control: no-store` on HTML, so browsers stop serving the bad version immediately.

**What web gets instead of a split:** upload-then-promote. `opennextjs-cloudflare upload` creates a version without serving it; you validate it on production infrastructure via its preview URL or a `Cloudflare-Workers-Version-Overrides` header at 0%; then you promote to 100%. That is the real benefit of versions — validating before any user sees it — without the split. Note `apps/web/package.json:17` currently defines only `deploy` (`opennextjs-cloudflare build && opennextjs-cloudflare deploy`), which is version-plus-100% in one step. Mechanics in [WEB.md](WEB.md).

**Revisit this** if any of these become true: OpenNext `skewProtection` is enabled; a version-affinity Transform Rule is added on `play10q.com`; game logic migrates from Edge Functions into the Worker; or traffic grows enough that 5% is statistically informative.

### Why iOS phased release is not a percentage gate

This is the most commonly mis-modelled fact in mobile release planning, and getting it wrong will produce a policy that does not do what you think.

> Apple: "apps and app updates in phased release can be manually downloaded from the App Store by anyone at any time."

Phased release throttles only the **silent auto-update push** to devices with automatic updates enabled. Any user who taps Update, and every new installer, gets the new build on day 1 at whatever percentage you are at.

**Consequences for policy:**

- **Never use phased release as a backend-compatibility gate.** If a build requires a backend change, that change must be live and backward compatible *before* the build reaches the store at all. See [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md).
- Day 1 at "1%" still puts the build in front of self-selected early updaters — your most engaged players, who are also the ones with streaks to lose.
- Pausing is still worth having: you may pause for up to 30 cumulative days, unlimited pauses, and it stops the auto-update push from widening.
- **"Release to All Users" is irreversible.** There is no un-releasing.
- **Pulling the app from sale permanently forfeits phasing for that version.** If you remove the app as an incident response, reinstating it makes the version available to everyone immediately regardless of the percentage reached. Never treat "remove from sale" as a rollback.

Android's staged rollout is the real thing: Play offers the update only to the selected `userFraction`. Where this policy says "percentage gate", it means Android literally and iOS approximately.

### Why the first release of each platform is a special case

Both stores disable their rollout controls on a first release. There is no percentage, and on Play, no halt — "you cannot halt your first release on a track since there would be no previous version to revert to."

**Policy for v1.0.0 on each store:** the entire rollout gate collapses into the TestFlight / closed-track steps, which become mandatory rather than optional, and the production step is all-or-nothing. Budget a longer beta soak (§3) precisely because the production step has no safety valve. See [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md).

---

## 2. The promotion gate

### 2.1 Gate tiers

Rather than a threshold table per store step, every step maps to one of four tiers. Tiers are what you tune; the mapping is fixed.

| Tier | Meaning | Population |
|---|---|---|
| **T0 — Smoke** | No public users. Pass/fail on a checklist, not on statistics | You, plus known testers |
| **T1 — Canary** | First real users on the build. Strictest tolerance. `WAIT` is the common verdict | Small, self-selected, high-engagement |
| **T2 — Expansion** | Stepping the percentage up. Rate-based, compared to the previous release | Growing |
| **T3 — Full** | The last step to 100%. T2 thresholds plus no unresolved warnings | Everyone |

| Platform | Step | Tier |
|---|---|---|
| Web | Version uploaded, preview URL / `Version-Overrides` at 0% | T0 |
| Web | Promoted to 100% — gate evaluated **after** promotion, lever is rollback | T1 → T3 as the soak elapses |
| iOS | Internal TestFlight (up to 100 App Store Connect users, no Beta App Review) | T0 |
| iOS | External TestFlight (up to 10,000, requires TestFlight App Review) | T1 |
| iOS | App Store phased, days 1–2 (1–2%) | T1 |
| iOS | Phased days 3–5 (5–20%) | T2 |
| iOS | Phased days 6–7 (50–100%) or "Release to All Users" | T3 |
| Android | Internal track (up to 100 testers, minutes to availability) | T0 |
| Android | Closed track (review required, up to 7 days) | T1 |
| Android | Production staged 5% | T1 |
| Android | Production staged 20% → 50% | T2 |
| Android | Production staged 100% | T3 |

### 2.2 The signal set

Every signal is filtered by `client_platform` **and** the build identifier. Never evaluate a signal across platforms — a shared React regression and an Android-only WebView regression look identical in an unfiltered view, and that one tag is the difference between an hour of triage and five minutes.

**Sentry** — filter `client_platform:<platform> release:10q@<version> dist:<build>`

| Signal | Definition |
|---|---|
| Crash-free session rate | Sentry Release Health for this `release`+`dist` |
| New issues for this release | `is:unresolved firstRelease:10q@<version> client_platform:<platform>` |
| Error-rate regression | Errors per session on this build ÷ same on the previous build of the same platform |

> **Caveat to verify before trusting the first number.** 10Q runs `@sentry/nextjs` inside a WebView, not a native crash reporter. "Crash-free session" therefore means "session with no unhandled JS error". A native WebView termination — an OOM kill on low-end Android, a WKWebView process crash — produces **no Sentry event at all** and will show up as a silent drop in `quiz_start` volume, not as a crash. That is why volume is a gate signal (§2.3) and not just a sanity check.

**PostHog** — filter `client_platform = '<platform>' AND app_version = '<version>'`

| Signal | Query shape |
|---|---|
| Game starts | `uniq(properties.attempt_id)` where `event = 'quiz_start'` |
| Quiz completion rate | `uniq` attempts finalized ÷ `uniq` attempts started |
| Auth success rate | `sign_in_succeeded` ÷ (`sign_in_succeeded` + `sign_in_failed`) — **needs the events in §0** |
| Answer-submit error rate | `app_error` where `location IN ('question_submit','timeout_submit')` ÷ all submit outcomes |

```sql
-- Completion rate and start volume, by platform and version.
-- uniq(attempt_id) is load-bearing: quiz_finalized fires from TWO call sites
-- (play/finalize/page.tsx:85 and results/page.tsx:247), and a user routed through
-- both double-counts. Counting raw events inflates completion above 100%.
SELECT
  properties.client_platform                              AS platform,
  properties.app_version                                  AS version,
  uniqIf(properties.attempt_id, event = 'quiz_start')     AS started,
  uniqIf(properties.attempt_id, event = 'quiz_finalized') AS finalized,
  round(100.0 * finalized / nullIf(started, 0), 2)        AS completion_pct
FROM events
WHERE timestamp > now() - INTERVAL 24 HOUR
  AND event IN ('quiz_start', 'quiz_finalized')
GROUP BY platform, version
ORDER BY platform, version
```

```sql
-- Answer-submit error rate. The two location values are the only submit failure
-- paths: play/q/[index]/page.tsx:353 (question_submit) and :244 (timeout_submit).
SELECT
  properties.client_platform AS platform,
  properties.app_version     AS version,
  countIf(event = 'answer_submit')                                        AS submits,
  countIf(event = 'app_error'
          AND properties.location IN ('question_submit','timeout_submit')) AS errors,
  round(100.0 * errors / nullIf(submits + errors, 0), 3)                   AS error_pct
FROM events
WHERE timestamp > now() - INTERVAL 24 HOUR
GROUP BY platform, version
ORDER BY platform, version
```

### 2.3 Thresholds

**All numbers below are starting points, not measurements.** They are chosen to be roughly right for an app with no baseline. Tune every one of them after three releases on each platform, and record the tuned values here with the date. A threshold nobody has ever tuned is a threshold nobody trusts, and an untrusted gate gets skipped.

Baselines mean **the previous release on the same platform**, not the current release on another platform.

| Signal | T0 | T1 (canary) | T2 (expansion) | T3 (full) |
|---|---|---|---|---|
| Crash-free sessions, absolute floor | n/a | ≥ 99.0% | ≥ 99.2% | ≥ 99.5% |
| Crash-free sessions vs previous release | n/a | ≥ −0.50pp | ≥ −0.30pp | ≥ −0.20pp |
| New issues **on the quiz path** | **0** | **0** | **0** | **0** |
| New issues elsewhere | 0 | ≤ 3, each < 0.5% of sessions | ≤ 5, each < 0.5% | ≤ 5, none unresolved |
| Errors per session vs previous release | n/a | ≤ 1.5× | ≤ 1.2× | ≤ 1.1× |
| `quiz_start` volume vs same-weekday baseline | n/a | ≥ −25% | ≥ −10% | ≥ −10% |
| Quiz completion rate vs baseline | n/a | ≥ −5pp | ≥ −3pp | ≥ −2pp |
| Auth success rate vs baseline | n/a | ≥ −8pp | ≥ −5pp | ≥ −3pp |
| Answer-submit error rate | n/a | ≤ 1.5× baseline, cap 1.5% | ≤ 1.5× baseline, cap 1.0% | ≤ 1.2× baseline, cap 1.0% |

**"Quiz path" means any issue whose stack or breadcrumbs touch** `play/`, `GameProvider`, `submit-answer`, `start-question-timer`, `finalize-attempt`, or the attempt domain. **Zero tolerance at every tier, including T0, regardless of count.** One occurrence is enough to stop. The reason is not severity in the abstract — it is that 10Q gives each player exactly one attempt per day, so a quiz-path failure is *irreversible for that user*. There is no retry that makes them whole. Every other class of bug is a rate question; this one is not.

**T0 is a checklist, not a query.** Pass requires all of:

- [ ] App launches from cold on a real device (not just a simulator)
- [ ] `/play/q/1 → /play/q/2` is a client transition with `GameProvider` intact — the [Gate 0](../01-architecture-decision.md) invariant
- [ ] A full 10-question attempt completes and finalizes, and the score matches the results page
- [ ] Sign-in works on the platform's actual auth path, and the session survives a cold restart
- [ ] Sentry receives an event from this build, tagged with the right `client_platform`, `release` and `dist`
- [ ] PostHog receives `quiz_start` with the right `client_platform` and `app_version`
- [ ] Deep link / invite link opens the right screen

The last two are not ceremony. If the identifiers are wrong, **every tier above T0 is silently evaluating the wrong build** and will report green.

### 2.4 Minimum denominator, and the third verdict

The gate returns one of three verdicts, not two.

| Verdict | Meaning |
|---|---|
| **GO** | Every signal green and the denominator is sufficient |
| **WAIT** | No signal is red, but the denominator is too small for the green ones to mean anything |
| **STOP** | A halting criterion (§6) fired, or a threshold is breached with a sufficient denominator |

**Do not evaluate rate signals below these denominators — return WAIT:**

| Tier | Sessions on this build | Completed attempts | Quiz drops observed |
|---|---|---|---|
| T1 | ≥ 200 | ≥ 50 | ≥ 1 |
| T2 | ≥ 1,000 | ≥ 250 | ≥ 1 since the last step |
| T3 | ≥ 2,000 | ≥ 500 | ≥ 1 since the last step |

Absolute counts (new issues, quiz-path issues) are **always** evaluated, at any denominator. A single quiz-path crash on a build with 12 sessions is STOP, not WAIT. Rates need volume; catastrophes do not.

If a build cannot reach the T1 denominator inside its soak window, that is information, not an obstacle. Either extend the soak, or accept explicitly that this step is unmeasured and lean on the next step's larger cohort. **Do not lower the denominator to manufacture a GO** — that converts the gate from a measurement into a formality.

> `WAIT` also has a per-platform cost you must weigh. On Android, an in-progress staged rollout that sits unpromoted **blocks the next release on that track**: "You cannot create a new release when you have outstanding releases." A long WAIT on Android is not free.

### 2.5 The go/no-go summary block

This is what `scripts/release/gate` prints and the `.agent/skills/release/` operator skill shows before any promotion. One screen, no scrolling, and the verdict is the last line so it is what the operator's eye lands on.

Design rules: every row shows **value, threshold, verdict** so a reader can audit the judgement rather than trust it. Comparisons name the baseline build. Warnings are listed even when the verdict is GO — the T3 gate refuses to advance while any warning is unresolved, so a warning ignored at T1 becomes a blocker later.

```text
10Q RELEASE GATE — ios 1.4.0 (build 42)
  release 10q@1.4.0   dist 42   sha af86e61   env production
  step    TestFlight external  →  App Store phased (day 1)      tier T1
  soak    26h10m elapsed        min 24h                          OK
  drops   2 quiz drops since promotion   min 1                   OK

DENOMINATOR                          value       min
  sessions on this build               412       200             OK
  completed attempts                    96        50             OK

SENTRY   client_platform:ios release:10q@1.4.0 dist:42
  crash-free sessions               99.51%    >= 99.00%          OK
    vs dist 41 (99.68%)             -0.17pp   >= -0.50pp         OK
  new issues, quiz path                  0            0          OK
  new issues, other                      2         <= 3          OK
  errors / session                   0.031    <= 0.052           OK
    baseline dist 41: 0.035, limit 1.5x

POSTHOG  client_platform=ios app_version=1.4.0
  quiz_start volume vs baseline       -4.1%   >= -25%            OK
  completion rate                     87.2%   >= 83.4%           OK
    baseline 88.4%, limit -5pp
  auth success rate                   94.0%   >= 88.2%           OK
    baseline 96.2%, limit -8pp
  answer-submit error rate            0.42%   <= 0.75%           OK
    baseline 0.50%, limit 1.5x, cap 1.5%

BLOCKERS  none
WARNINGS  SENTRY-10Q-4F2  2 sessions  /leaderboard  non-quiz-path, under rate floor
          -> must be resolved or explicitly waived before T3

VERDICT   GO
NEXT      App Store Connect > 10Q > 1.4.0 > Phased Release for Automatic Updates
          resume to day 2 (2%).  Re-gate in 24h.
```

A STOP block replaces the last three sections and names the criterion, not just the number:

```text
BLOCKERS  H1 quiz-path issue: SENTRY-10Q-511 TypeError in GameProvider.submitAnswer
                              7 sessions, all ios 1.4.0/42, first seen 04:12Z
          Each occurrence consumes a player's single daily attempt. Not rate-gated.

VERDICT   STOP
NEXT      Do NOT advance phased release. Pause it (this does not stop manual
          downloads - see ROLLOUTS.md 6.2). Ship the fix as build 43.
          If the cause is server-side, prefer the PostHog kill-switch flag or the
          minimum-version gate - both act faster than an App Review cycle.
```

---

## 3. Soak times

**Soak is measured from when the step became live to real users, not from when you clicked promote.** On Android a closed-track release is not live until review completes, which is up to 7 days.

| Platform | Step | Minimum soak | Also required |
|---|---|---|---|
| Web | Preview URL smoke (T0) | 10 min | Full manual attempt |
| Web | 100% — watch window | **2 h**, of which ≥ 30 min post-drop | Spans one 11:30 UTC drop |
| iOS | Internal TestFlight | 4 h | ≥ 2 testers, ≥ 1 full attempt each |
| iOS | External TestFlight | **48 h** | ≥ 1 drop |
| iOS | Phased day 1 → 2 | 24 h | ≥ 1 drop |
| iOS | Phased day 2 → 5 | 24 h per step | ≥ 1 drop per step |
| iOS | Phased day 5 → 100% | 24 h | ≥ 1 drop, zero open warnings |
| Android | Internal track | 4 h | ≥ 2 testers, ≥ 1 full attempt each |
| Android | Closed track | **48 h after review completes** | ≥ 1 drop |
| Android | Production 5% → 20% | 24 h | ≥ 1 drop |
| Android | 20% → 50% → 100% | 24 h per step | ≥ 1 drop per step |
| Any | First release of a platform | **7 days** on the beta track | ≥ 3 drops, ≥ 5 distinct testers |

### The drop rule

**Every soak must span at least one 11:30 UTC quiz drop.** This is 10Q-specific and non-negotiable.

The drop is when the highest-risk code paths run: `start-attempt` issuing a fresh attempt, the server-authoritative 12s timer, the whole submit/finalize chain, and the leaderboard write. A build soaked from 14:00 to 22:00 UTC has exercised results screens and leaderboards and has **not tested the game**. A perfect gate report from a soak that missed the drop is not evidence.

A corollary the gate script should enforce: for a build promoted at, say, 12:00 UTC, the 24h minimum is really "until after tomorrow's drop", ~23.5h. For one promoted at 11:00 UTC, one drop lands 30 minutes in — that satisfies the drop rule but not the 24h clock. Both conditions must hold; neither substitutes for the other.

### Why mobile soaks longer than web

Not caution for its own sake. Four structural reasons:

1. **Rollback does not exist.** Web reverts in one command in seconds. iOS has no rollback at all; the fix is a new build through review. Android's halt stops distribution but explicitly **does not downgrade anyone**: "Users who already received the app version in your staged rollout version will remain on that version." The cost of being wrong is orders of magnitude higher, so buy more evidence before committing.
2. **Adoption is slow and self-selected.** Web replaces its entire population within one `no-store` HTML fetch — everyone is on the new build within minutes, so your signal is complete almost immediately. A mobile build trickles out over days to a cohort skewed toward automatic-updates-on, highly engaged players. Small early numbers are neither representative nor sufficient.
3. **Bad mobile builds persist.** A store binary stays installed indefinitely against a continuously deployed backend. A web mistake is gone the moment you roll back; a mobile mistake joins the version tail you must support until the minimum-version gate forces it out. See [VERSIONING.md](VERSIONING.md).
4. **Store latency compounds errors.** Fixing an iOS mistake costs a full App Review cycle — typically under 24 hours (Apple: "90% of submissions are reviewed in less than 24 hours"), sometimes far longer. Expedited review exists but is discretionary and, per Apple's own numbers, usually slower than just waiting. Design so you do not need it.

---

## 4. When signals are ambiguous

The characteristic failure mode of a canary is over-reacting to a small absolute number on a small denominator. Three new Sentry issues at 1% of iOS is not information; it is the tail of a distribution you would also see on the previous build if you looked this hard. These rules resolve ambiguity without inventing certainty.

**1. Rates, never counts — except for quiz-path issues.** Below the §2.4 denominator the answer is WAIT. The only counts that are evaluated at any denominator are quiz-path issues (always STOP at ≥1) and hard security regressions.

**2. Ask whether the issue is new to the *build* or new to *your attention*.** Before treating a new issue as a regression, query the same signature against the previous release. Sentry's `firstRelease` will call it new if the identifiers only just started being stamped — every issue looks new on the first release that has a `release` set. Expect a wave of phantom "new issues" on the first properly-stamped build and discount it explicitly.

**3. Compare same-platform, same-weekday, same-phase-of-day.** A daily game has a huge diurnal cycle. Comparing a post-drop window against a pre-drop window will show a completion-rate collapse that is entirely an artefact. The baseline for any rate is the same clock window on the same weekday of the previous release.

**4. When a rate is ambiguous, look at the absolute user impact instead.** "0.8% submit error rate, up from 0.5%" on a 400-session build is 3 users vs 2 — noise. The same delta on 40,000 sessions is 120 real players who lost their daily attempt. Same ratio, different decision. The gate report shows both for exactly this reason.

**5. Prefer widening the cohort over waiting on a stalled one.** If T1 is clean but under-powered after its full soak, and no signal is trending the wrong way, advancing to the next step to acquire denominator is a legitimate choice — **on Android and web**, where you can still halt or roll back. It is not legitimate at the last step to 100%, and it is not legitimate on iOS once you are past the point where pausing helps.

**6. Two ambiguous signals pointing the same direction are one clear signal.** Completion rate down 2pp (inside tolerance) *and* submit error rate up 1.3× (inside tolerance) *and* start volume down 8% (inside tolerance) is a coherent story about the quiz path, even with every individual row green. The gate cannot detect this; the operator must. **Any three warnings in the same funnel stage is a STOP**, and the gate should surface a `CORRELATED WARNINGS` line when it sees them.

**7. Cross-platform disambiguation is nearly free — use it first.** If web and Android are healthy and iOS is not, the cause is in the iOS build or WKWebView, not in a shared React change or an Edge Function. If all three degrade at once and none of them shipped, look at Supabase — which deploys by hand, outside CI, and is therefore the most likely uncorrelated change. That single `client_platform` tag is the cheapest triage tool in the stack.

**8. Write the ambiguity down.** Whatever you decide, record the numbers, the call, and the reason in the release notes for that build. The third time you see the same ambiguous pattern you will know whether it ever turned into anything — and that is how these thresholds get tuned from guesses into measurements.

---

## 5. Coordinating a cross-platform feature launch

**The problem:** Apple review is unpredictable and usually the long pole; Google review is up to 7 days and often slower on new accounts; web ships in minutes. A feature that must appear everywhere at once cannot be coordinated by timing three submissions.

**The rule: never coordinate by timing. Coordinate by decoupling.** Timing-based launches fail on the one variable you do not control.

### 5.1 The recommended pattern

Five phases. Phases 1–4 are invisible to users; only phase 5 is the launch.

| # | Phase | What happens | Why here |
|---|---|---|---|
| 1 | **Backend first, backward compatible** | Deploy Supabase migrations + Edge Functions supporting the new feature, **additively only** — new fields, new endpoints, no removals, no repurposed fields, no changed semantics for existing callers | Every client version in the field must keep working. Old store binaries are the constraint, and 22 Edge Functions deploy by hand outside CI, so this step is manual and needs its own verification |
| 2 | **Ship the client code to all three, flag-off** | The feature merges and ships in every channel, gated behind a PostHog flag that is off | The store binaries acquire the capability weeks before it is used. This is the entire trick |
| 3 | **iOS submitted first, held** | Submit to App Review as early as possible — it has the longest and least predictable lead time. Choose **"Manually release this version"** so approval parks the build in *Pending Developer Release* rather than publishing it | Approval and publication become two separate events you control. Apple emails a reminder if a version sits there over 30 days |
| 4 | **Android submitted, held with Managed Publishing** | Turn Managed Publishing on before submitting. Approved changes queue in "Changes ready to publish" until you press Publish | Same decoupling, different mechanism |
| 5 | **Launch = flip the flag** | Both binaries are already installed. Web is already deployed. Turn the flag on and the feature appears everywhere within a flag-poll interval | The launch is now an operation you control to the second, on a channel with instant rollback |

The pattern's real payoff is that **the launch is reversible**. Turn the flag off and the feature disappears from all three platforms at once, with no store involvement. Nothing else in the mobile release toolkit can do that.

### 5.2 When you cannot flag it

Some changes cannot hide behind a flag: a navigation restructure, a native permission prompt, an app icon, anything the store reviews as part of the binary. For those, the fallback order is:

1. **Let web lead.** Ship on web, then mobile when approved. Correct when the feature is genuinely additive and a staggered appearance costs nothing. This is the default — do not manufacture simultaneity that no user asked for.
2. **Hold web to match mobile.** Only when simultaneity is a real product requirement (a marketing moment, a competitive event). Costs you the fastest channel's speed; be sure it is worth it.
3. **Ship staggered and say so.** "Coming to Android next week" in the release notes beats a two-week hold. Users tolerate staggered rollouts; they do not tolerate a broken one.

### 5.3 Holding mechanisms — the gotchas that will bite

| Mechanism | Holds | Does **not** hold |
|---|---|---|
| **Apple "Manually release this version"** | Publication of an approved version (sits in Pending Developer Release) | Anything else. Composes with phased release — phasing can start from Pending Developer Release |
| **Google Managed Publishing** | Full and staged rollouts, pre-registration, store listing changes, app content changes | **Increasing an existing staged rollout to 100%**; release notes; device exclusion rules; testing-track tester lists; unpublishing; in-app products; price changes |

**That first exclusion is the trap.** If a staged rollout is already in progress, Managed Publishing will not stop you or anyone else from taking it to 100%. Managed Publishing gates *starting* a rollout, not *finishing* one.

Two more that break automation:

- **Managed Publishing has no documented API.** Google's help page never mentions the Play Developer API, and `Edits.commit`'s `changesNotSentForReview` is a different mechanism (it withholds changes from review entirely). **Drive the publish step from the Console UI, by a human.** Do not build a pipeline that assumes otherwise.
- **Play API edits are single-slot.** "If you create a new edit, any existing edit you may have open is invalidated" — and a human clicking around the Console while an API edit is open will discard it. If a release script talks to the Play API, nobody touches the Console until it finishes. This is a real source of flaky CI failures.

### 5.4 The skew contract this all rests on

Because the five phases put a backend change live weeks before the last client adopts it, **every API change must tolerate version skew**. This is the same requirement stated in [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) and [../04-shared-code-architecture.md](../04-shared-code-architecture.md), and it is what makes phase 1 safe.

Additive only. Never remove a field, never repurpose one, never change the meaning of an existing response for existing callers. If a change cannot be made additively, it needs a versioned endpoint and a deprecation window measured against the version tail in [VERSIONING.md](VERSIONING.md) — not a coordinated cutover.

**Do not use `packages/contracts/openapi.yaml` to reason about this.** It is abandoned and wrong — it documents 5 of 22 functions, every path is wrong, and the answer-submit field name is wrong. The real contract is `apps/web/src/lib/api/edge-functions.ts`.

---

## 6. Feature flags

### 6.1 Status: available, zero usage

PostHog feature flags come with the `posthog-js` dependency already in `apps/web/package.json:33`. A repo-wide grep for `isFeatureEnabled`, `onFeatureFlags`, `getFeatureFlag` and `feature_flag` returns **nothing** — no flag has ever been used in 10Q.

That is the gap worth closing before the first store binary ships, because a flag is the only fast lever that exists on a channel with no rollback.

### 6.2 Why flags are structurally necessary here, not just convenient

Rank the levers available when a shipped iOS build misbehaves, by how fast they act:

| Lever | Time to effect | Cost |
|---|---|---|
| PostHog feature flag off | Seconds to minutes | None, if the code was written to be flagged |
| Server-side behavior change in an Edge Function | Minutes | Manual deploy, affects all clients including healthy ones |
| Minimum-version gate (force upgrade) | Immediate, but blunt | Locks users out until they update — see [VERSIONING.md](VERSIONING.md) |
| Pause iOS phased release | Minutes | Does not stop manual downloads, does not help anyone already updated |
| Halt Android rollout | Minutes | Stops new distribution only; nobody is downgraded |
| New build through review | Hours to days | A full release cycle |

**The top row is the only one that is both fast and precise.** Everything else is either slow, blunt, or does not reach users who already have the build. That asymmetry is the argument.

### 6.3 Rules

**1. Flag anything that must appear simultaneously across platforms.** This is the §5 pattern and the primary use.

**2. Flag anything on the quiz path that ships in a store binary.** Timer behavior, submit logic, the attempt state machine, scoring display. Not because you expect to fail — because when you do, this is the only lever that acts before tomorrow's drop.

**3. Flags fail closed to the old behavior.** A flag evaluation that errors, times out, or has not resolved yet must produce the pre-existing behavior. Never the new one. A WebView on a bad mobile network is the normal case, not the edge case, and a half-applied launch is worse than no launch.

**4. Resolve before the quiz UI renders, or default it.** `posthog-js` fetches flags asynchronously after `init`. Anything gating the quiz path must either be resolved before first paint or have an explicit default — otherwise the first render of the day races the flag fetch and users see the UI flip mid-question.

**5. Target by rollout percentage on `distinct_id`, not by person properties.** 10Q is anonymous-first: `posthog-js` defaults to `person_profiles: 'identified_only'`, and `identifyUser` fires only for non-anonymous users, so **most sessions have no person profile at all** (see [../OBSERVABILITY.md](../OBSERVABILITY.md)). Property-based targeting will silently miss the majority of your players. Percentage rollout on `distinct_id` works regardless.

**6. Never fork the flag key by platform.** One flag, evaluated everywhere, released per-platform through the *rollout condition* if needed. `new_results_screen`, not `new_results_screen_ios`. Platform-prefixed flags reproduce the exact anti-pattern [../OBSERVABILITY.md](../OBSERVABILITY.md) rejects for event names, and make "is this feature live everywhere?" unanswerable at a glance.

**7. Every flag has an owner and a removal date at creation time.** A flag is a permanent branch in the code that must be tested both ways. The cost is real and it compounds. Delete flags after the feature is fully rolled out and the oldest supported binary contains it — which is a [VERSIONING.md](VERSIONING.md) question, not a calendar question.

**8. Do not flag everything.** Flag it if (a) it must appear simultaneously across platforms, (b) it touches the quiz path in a store binary, or (c) it depends on a backend change that might need to be pulled back. Otherwise ship it plain.

### 6.4 Flags are not a rollout mechanism for the *app*

A flag rolls out a *feature*. It cannot canary a build — a bad build crashes before any flag is evaluated, and the version-skew risks in §1 are about code the flag does not guard. Use flags to decouple feature launches from store timelines and as a kill switch. Use the store rollout controls to roll out builds. They solve different problems and neither substitutes for the other.

---

## 7. Halting criteria

**Slow down when you are uncertain. Stop when you are harmed.** The distinction is not severity in the abstract — it is whether continuing costs users something they cannot get back.

### 7.1 Stop immediately — do not wait for more data

Any one of these is sufficient at any denominator, including a single occurrence:

1. **Any error on the attempt path that can lose or mis-score an attempt.** Failures in `start-attempt`, `start-question-timer`, `submit-answer` or `finalize-attempt`; the timer disagreeing with the server; `GameProvider` unmounting mid-quiz. One attempt per player per day means every occurrence is permanent for that player.
2. **Session loss on an anonymous account.** 10Q is anonymous-first: the anonymous identity *is* the account. A user who loses their session does not get signed out — they become a different person, with no streak, no history, and **no recovery path**. Treat any spike in new-anonymous-user creation without a matching drop in returning users as a session-loss event. This is the most destructive failure mode in the product and the easiest to miss, because it produces satisfied-looking `quiz_start` volume.
3. **Crash-free session rate below 98.0% absolute**, regardless of tier or baseline.
4. **`quiz_start` volume down more than 40% vs baseline** with no corresponding error signal. Silence is the signature of the failure Sentry cannot see: a WebView that terminates before the SDK reports (see §2.2).
5. **A version-skew break** — clients erroring against the backend because a change was not backward compatible. Fix forward on the server; do not wait on a client rollout.
6. **Any security regression**: answer-key exposure (`is_correct` readable by `anon` or `authenticated`), an auth bypass, a leaderboard-integrity hole. See [../03-blocking-fixes.md](../03-blocking-fixes.md) A1/A6 for why this class is treated as live risk rather than theoretical.
7. **Contact from Apple or Google about policy.** Stop the rollout, then respond. Rolling further while under review compounds whatever the finding is.
8. **Data loss or corruption of any kind** — streaks, scores, league membership.

### 7.2 Slow down — pause, investigate, do not halt

- Elevated error rate off the quiz path (profile, leaderboard, settings)
- One or two new issues under the rate floor with a small denominator
- A performance regression with no errors
- Signals disagreeing across platforms (triage first — §4 rule 7)
- The denominator being insufficient (that is WAIT, §2.4)
- A single tester report you cannot reproduce and cannot see in aggregate

**Slowing down means: stop advancing, keep the current percentage, extend the soak, re-gate after the next quiz drop.** It does not mean halting distribution.

### 7.3 What "stop" actually does on each channel

This table is the reason §6 exists. The store controls are much weaker than they look, and an operator who believes "halt" undoes the release will make a bad call under pressure.

| Channel | Stop action | What it actually achieves | What it does **not** do |
|---|---|---|---|
| **Web** | `wrangler rollback` or `wrangler versions deploy <PREV_ID>@100%` | Full revert to the previous code+assets in seconds. `no-store` on HTML (`middleware.ts:34`) means browsers pick it up immediately | Does not revert Supabase data or Edge Functions — separate pipeline, separate rollback |
| **iOS, in phased release** | Pause phased release (up to 30 cumulative days) | Stops the auto-update push widening | **Does not stop manual downloads by anyone**, and does not affect users who already updated |
| **iOS, released to all** | Nothing | — | There is no rollback. The only fix is a new build through review |
| **iOS, emergency** | Remove from sale | Stops all downloads | **Permanently forfeits phased release for that version.** Reinstating makes it available to everyone at once. Near-last resort |
| **Android, staged** | Halt the rollout | Stops further distribution; the previous version serves new and eligible users | **Does not downgrade anyone.** Everyone who already updated keeps the bad build |
| **Android, at 100%** | Halt (supported on all tracks except internal) | Previous live version takes its place for new and eligible users | Same — no downgrade, no remote uninstall. Fallback cannot be a version with policy violations |
| **Any platform, already-updated users** | PostHog flag off, or the minimum-version gate | The only levers that reach a binary already installed | Flags only cover code you wrote to be flagged |

**The operational consequence, stated plainly:** on mobile, "stop the rollout" protects people who have not updated yet. It does nothing for the people already harmed. Reaching them requires a flag, a server-side change, or a forced upgrade. Google says it directly — if the release "is being used by a large percentage of your users, halting it might not be the most effective solution." The real fix for a bad Android build is shipping a higher `versionCode`, not halting.

### 7.4 After a stop

1. **Halt or roll back first, diagnose second.** Web reverts in seconds; take the revert and investigate from a healthy state.
2. **Determine the blast radius in users, not percent** — how many people lost an attempt, a streak, or a session. That number decides whether remediation is needed and drives what the release notes say.
3. **Prefer a server-side fix.** An Edge Function change reaches every client immediately, including binaries you cannot update. A client fix reaches iOS after a review cycle. When both are possible, the server fix ships first and the client fix follows in the normal release.
4. **Burn the build number.** A pulled `dist` / `versionCode` is never reused. Play rejects a duplicate `versionCode` outright, and reusing a Sentry `dist` for different bytes destroys symbolication for both. See [VERSIONING.md](VERSIONING.md).
5. **Write down which signal caught it — or that none did.** "None did" is the most valuable outcome a stop can produce: it is the only evidence that tells you what to add to §2.2. A gate that never learns from its misses is decorative.

---

## 8. DECISION REQUIRED

Unresolved items this policy depends on. None of these should be invented by an agent executing a release — escalate to a human.

| # | Decision | Why it blocks this doc | Who |
|---|---|---|---|
| D1 | **Google Play Console account type: personal or organization?** | A personal account created after 2023-11-13 must run a closed test with **12 testers opted in continuously for 14 days** before it can even apply for production access, and that application is a human-reviewed written questionnaire (~7 days). If personal, the Android first-release timeline in §3 is ~4 weeks longer and must start before anything else | Riley |
| D2 | **Bundle ID / application ID**, and Apple Team ID | Every gate query filters on `client_platform`; every store operation needs these. Marked unset repo-wide — no `capacitor.config.*` exists | Riley |
| D3 | **Tuned thresholds**, replacing every number in §2.3 | They are starting points chosen without a baseline. Revisit after three releases per platform and record the tuned values with a date | Whoever runs release 3 |
| D4 | **Denominator floors in §2.4 vs actual DAU** | 200 sessions may be an hour or a week. If T1 cannot be reached inside its soak, either the floors or the soak must change — deliberately, not by quietly lowering the bar | Riley |
| D5 | **Which environment TestFlight and Play internal builds point at** | Only production exists today — Cloudflare, Supabase, Sentry and PostHog all have exactly one. Until staging exists, beta testers write to the production leaderboard and pollute the very metrics this gate reads | Phase 2 |
| D6 | **Whether the daily quiz drop at 11:30 UTC needs a reviewer workaround** | A reviewer opening the app before 11:30 UTC sees a countdown, not a quiz. Flagged as a real rejection risk in [../STORE_READINESS.md](../STORE_READINESS.md). It also means a *review* can fail for reasons unrelated to the build, mid-rollout | Riley |
| D7 | **Who may waive a warning at T3** | §2.5 refuses to advance with unresolved warnings. Somebody must be able to override, and it should be a named person, not the agent running the script | Riley |

---

## 9. Explicitly out of scope: OTA / live updates

Capacitor OTA (Appflow live updates, or a self-hosted equivalent) would change this entire document — it would give mobile a web-like rollback and make most of §7.3 obsolete. **It is deferred and V1 does not use it.** V1 is: web → normal deploy, iOS → TestFlight/App Store, Android → Play tracks.

Recorded here as a future option with its costs, so it is evaluated rather than assumed:

- **Apple Guideline 2.5.2** prohibits downloading code "which introduces or changes features or functionality of the app." The operative test is *changes features*. Practical rule: OTA may fix and refine what was reviewed; it may never add what was not.
- The widely-cited license-agreement basis for this is **stale**. Nearly every article on the subject cites ADPLA §3.3.2 and its carve-out for "scripts and code downloaded and run by Apple's built-in WebKit framework." In the current agreement that clause is renumbered §3.3.1(B) and the WebKit/JavascriptCore language **has been removed entirely**. The permission is now framework-agnostic and conditional: interpreted code may be downloaded only if it (a) does not change the app's primary purpose or add functionality inconsistent with what was submitted and advertised, (b) does not bypass signing, sandbox or OS security, and (c) does not create a store for other applications. Conjunctive, and (a) is judged against the app *as submitted*.
- **Guideline 4.2.3(ii)** applies if the shipped bundle is a thin shell that pulls assets on first launch: you must disclose the download size and prompt before doing so.
- Operationally it adds a second update channel with its own versioning, its own rollback semantics, and its own skew surface against the Edge Functions. That is real cost, not a free win.

**If OTA is ever adopted, this document is rewritten, not amended.** The rollout shapes, the soak times and the halting criteria all change when mobile gains a fast revert.

---

## Related

- [WEB.md](WEB.md) · [IOS.md](IOS.md) · [ANDROID.md](ANDROID.md) — per-platform mechanics
- [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) — channel model, version-skew contract
- [VERSIONING.md](VERSIONING.md) — identifiers, version tail, minimum-supported-version gate
- [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — one-time setup, accounts, signing, listings
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — the identifiers and events this gate reads
- [../STORE_READINESS.md](../STORE_READINESS.md) — compliance register
- [../03-blocking-fixes.md](../03-blocking-fixes.md) — must land before any external build exists
- [../05-migration-plan.md](../05-migration-plan.md) — Phase 2 (foundations) and Phase 9 (release machinery)
