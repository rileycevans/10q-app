# Release Architecture

**The root release document.** Every other doc in `docs/cross-platform/release/` implements one lane of what is decided here.

This document defines four things and nothing else:

1. **The fan-out** — how one commit becomes three independently-published artifacts.
2. **The version-skew rule** — the hard architectural constraint that falls out of that fan-out.
3. **The release state machine** — `prepare → submit → release`, three verbs that are never collapsed.
4. **The interlocks** — how observability, testing, distribution and automation gate each other.

Procedures live in the per-channel docs. If you are here to actually ship something, read this once for the invariants, then go to [WEB.md](WEB.md), [IOS.md](IOS.md) or [ANDROID.md](ANDROID.md).

> **Read this first if you are an agent.** Almost none of the machinery described here exists in the repo today. The gap is catalogued precisely in [§8 What does not exist yet](#8-what-does-not-exist-yet). Do not assume a command works because this document names it.

---

## 1. The core principle

> **One codebase does not mean one deployment channel.**

10Q ships from a single source tree — `apps/web` is the canonical React frontend for all three platforms ([ADR-001](../01-architecture-decision.md)). But the tree fans out into **three independently controllable release channels plus a shared backend**, and those four things go public at different times, through different gatekeepers, with different undo semantics.

### The fan-out

```text
                              one commit on main
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
  ┌─────▼──────────────┐   ┌───────────▼───────────┐   ┌──────────────▼─────────┐
  │ BACKEND            │   │ WEB                   │   │ NATIVE                 │
  │ supabase/          │   │ apps/web → OpenNext   │   │ apps/web with          │
  │  migrations +      │   │  → CF Worker 10q-web  │   │  output:'export'       │
  │  22 Edge Functions │   │                       │   │  → Capacitor shell     │
  └─────┬──────────────┘   └───────────┬───────────┘   └───────┬────────┬───────┘
        │                              │                       │        │
        │ supabase db push             │ upload → version      │ IPA    │ AAB
        │ supabase functions deploy    │ (exists, 0% traffic)  │        │
        │                              │                       │        │
        │                        ┌─────▼─────┐        ┌────────▼───┐ ┌──▼──────────┐
        │                        │ versions  │        │ TestFlight │ │ Play        │
        │                        │  deploy   │        │  internal  │ │  internal   │
        │                        │  @100%    │        │ (no review)│ │ (minutes)   │
        │                        └─────┬─────┘        └────────┬───┘ └──┬──────────┘
        │                              │                       │        │
        │                              │             TestFlight external  closed/open
        │                              │             + TestFlight App Rev. + Play review
        │                              │             (hours–days)         (up to 7 days)
        │                              │                       │        │
        │                              │                 App Review    Production track
        │                              │                 (~90% <24h,   staged rollout
        │                              │                  can be days)  1% → … → 100%
        │                              │                       │        │
        │                              ▼                       ▼        ▼
        │                          PUBLIC                  PUBLIC     PUBLIC
        │                          T + minutes             T + days   T + hours…days
        │
        └──► ONE backend, serving all of these simultaneously:
               • the web version deployed three minutes ago
               • the web bundle loaded into a tab that was opened yesterday
               • iOS 1.2.0 (build 31), approved in June, never updated
               • Android 1.3.1 (build 39), currently at 50% staged rollout
             ────────────────────────────────────────────────────────────────
             →  THIS IS WHY THE VERSION-SKEW RULE EXISTS (§2)
```

### What the fan-out means in practice

| Fact | Consequence |
|---|---|
| Web goes public in minutes; iOS in days | A web hotfix ships **without** a mobile release, and should. Do not hold a web fix for a store cycle. |
| Apple review is usually fast but unbounded; Google's closed/open track review runs **up to seven days or longer** | Never plan a coordinated cross-platform launch on review timing. Plan it on a feature flag. |
| Mobile has no rollback | Web rollback is one command. A shipped store binary cannot be recalled — halting only stops *new* installs. See [ROLLBACKS.md](ROLLBACKS.md). |
| The backend is deployed on a fourth, completely separate pipeline (by hand today) | Backend changes reach 100% of every client instantly, including binaries months old. |
| A store binary's config is inlined at build time | You cannot repoint or restamp a shipped artifact. `NEXT_PUBLIC_*` is compiled in. |

**Therefore the release verbs are per-channel, not global.** "Release 10Q" is not an operation. "Release web 1.4.0" is.

---

## 2. The version-skew rule

> **HARD CONSTRAINT.** No change to a Supabase Edge Function, a database migration, or any wire contract may assume that web, iOS and Android update atomically. They never do. The backend must remain correct for **every client version still in the field**, with no upper bound on how old that is.

This is not a style preference. It is the direct consequence of §1: store-reviewed binaries stay installed indefinitely, while `supabase functions deploy` takes effect for everyone at once.

### What "the contract" is

The contract is **`apps/web/src/lib/api/edge-functions.ts:275-666`** — every function name, method, request body, response type and `requireAuth` flag in one block, plus the Deno handlers in `supabase/functions/*/index.ts`.

**`packages/contracts/openapi.yaml` is not the contract.** It documents 5 of 22 functions, every path is wrong, and it names `selected_choice_id` where the server requires `selected_answer_id`. A client generated from it would 400 on every answer. See [02-current-state.md §4](../02-current-state.md).

### The additive-only rule

| You MAY | You MAY NOT |
|---|---|
| Add a **new response field** | Remove a response field any shipped client reads |
| Add a **new optional request field** whose absence reproduces the old behavior exactly | Make a previously-optional request field required |
| Add a **new Edge Function** | Rename a field (this is *remove + add*, and the remove half breaks old clients) |
| **Widen** an accepted input set (accept more values, looser validation) | **Narrow** validation — start rejecting inputs an old client still sends |
| Add a **new error code** (see the two-table gotcha below) | Repurpose a field: change its type, units, nullability or semantics |
| Add a new enum value the client treats as "unknown" | Change the meaning of an existing enum value or error code |
| Change internals that produce the same wire output | Change a default such that an old client's behavior silently flips |

**"Never remove or repurpose a field" is the whole rule in six words.** Repurposing is the more dangerous half, because removal produces an obvious `undefined` while repurposing produces a plausible wrong answer.

### Two repo-specific gotchas that make additive changes non-trivial

**1. Error codes are forked and must be added twice.**
`packages/contracts/src/errors.ts:7-38` and `supabase/functions/_shared/response.ts:8-24` are two hand-maintained copies of the same `ErrorCodes` map. Adding a code to only one produces `{ code: undefined }` on the wire — this has already happened once with `INVALID_ANSWER` ([03-blocking-fixes.md §C5](../03-blocking-fixes.md)). An old client receiving an unknown code degrades to a generic message, which is the *intended* behavior; an old client receiving `undefined` cannot be alerted on or counted, which is not.

**2. CORS is forked twelve ways.**
`supabase/functions/_shared/cors.ts:11-13` pins `Access-Control-Allow-Headers` to `"authorization, x-client-info, apikey, content-type"`. Twelve functions import it; ten more hardcode their headers inline (plus `get-global-leaderboard/index-standalone.ts`). **Any new request header — including `X-Client-Version` below — fails browser preflight until it is added in all of those places.** The failure mode is an OPTIONS rejection, which surfaces as a network error with no useful message.

### How to deprecate a field

Four phases. **Phase 4 is gated on telemetry and the minimum-version gate, never on a calendar.**

| Phase | Action | Who ships | Exit condition |
|---|---|---|---|
| 1. Dual-write | Emit the new field **alongside** the old. Both populated, both correct. | Backend only | Deployed |
| 2. Dual-read | Ship clients that read the new field, tolerate the old. | Web immediately; iOS/Android on their own schedule | All three channels have a public release reading the new field |
| 3. Measure | Query PostHog for the `app_version` distribution of clients still in the field. | — | Population reading the old field is below the agreed threshold |
| 4. Remove | Delete the old field. | Backend only | The minimum-supported-version gate has been raised **past the last version that read it** |

> **Phase 3 is impossible today.** There is no `app_version` on any event ([OBSERVABILITY.md](../OBSERVABILITY.md)). Until the identifier stamp lands, *no field can ever be safely removed* — you cannot see who would break.

#### Worked example (a real one, from this repo)

`supabase/functions/resume-attempt/index.ts:211-212` returns `question_started_at` / `question_expires_at`. `apps/web/src/domains/attempt/index.ts:129-130` reads `current_question_started_at` / `current_question_expires_at`. They have never matched — resume always yields `undefined` timings ([03-blocking-fixes.md §C3](../03-blocking-fixes.md)).

The tempting fix is to rename the server fields. **Do not.** That is a rename, and on the day a native binary exists it breaks every installed copy that reads the un-prefixed names.

The correct fix under this rule:

1. `resume-attempt` emits **both** `question_expires_at` and `current_question_expires_at` with identical values.
2. Clients read `current_question_expires_at`, falling back to `question_expires_at`.
3. Once telemetry shows no client in the field reads the old name, drop it.

Fix it this way **now**, while web is the only client and the cost is zero, so the habit is established before it is load-bearing.

### The two mechanisms that must exist and do not

Version skew is unmanageable without a way to (a) *see* which client versions are live and (b) *refuse service* to versions that are too old to be correct. Neither exists.

#### (a) `X-Client-Version` request header

One choke point: `apps/web/src/lib/api/edge-functions.ts:41-43` builds the header object for all 22 functions. Every request already flows through it.

```ts
// apps/web/src/lib/api/edge-functions.ts — inside callEdgeFunction()
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  'X-Client-Version': CLIENT_VERSION,   // e.g. "ios/1.4.0+42", "web/1.4.0+af86e61"
};
```

Format: `<client_platform>/<app_version>+<app_build>` — the same three identifiers PostHog and Sentry receive (§6), so a Sentry `release`/`dist` pair and a server log line are joinable without a translation table.

Send it from **web too**, from day one. Web never needs a force-upgrade, but it is the only way to measure the version distribution of the largest client, and one implementation covering all three platforms is the point.

**Blocked on:** the CORS allow-list fix above, and a version source of truth ([VERSIONING.md](VERSIONING.md)).

#### (b) Minimum-supported-version gate + force-upgrade screen

Server-side, in `supabase/functions/_shared/`, called by every function. Compares the parsed header against a per-platform minimum and returns a new terminal error code:

```
UPGRADE_REQUIRED  →  client renders a blocking screen with a store link
```

Design rules:

- **Fail-open is the current posture and it is a trap.** The whole fleet runs `verify_jwt = false` (`supabase/config.toml:42-91`), so a function that forgets to call the gate simply does not enforce it ([03-blocking-fixes.md §A2](../03-blocking-fixes.md)). The gate must be invoked in the shared request preamble, not per-function at the author's discretion.
- **Separate soft from hard.** A soft minimum nags; a hard minimum blocks. Only the hard minimum unblocks deprecation Phase 4.
- **Set it permissively at first** and raise it deliberately ([05-migration-plan.md Phase 2](../05-migration-plan.md)).
- **`UPGRADE_REQUIRED` must exist in both `ErrorCodes` tables** before any function returns it.

> ### The one thing you cannot add later
>
> **The force-upgrade screen must ship in the first store binary.** A binary that does not understand `UPGRADE_REQUIRED` renders a generic error and strands the user with no path forward — and you cannot patch it, because patching it requires the update they cannot be told to install. The gate's *enforcement* can be turned on later; the client's *ability to respond to it* cannot.
>
> Treat this as a launch blocker for iOS and Android, not a follow-up.

---

## 3. The release state machine

Three verbs. **They are never collapsed, on any platform, for any reason.**

| Verb | Does | Public impact | Reversible? |
|---|---|---|---|
| **prepare** | Stamps identifiers, builds, runs gates, produces one addressable artifact | **None** | Yes — discard it |
| **submit** | Hands the artifact to the gate that must approve it (our smoke suite for web; a store reviewer for iOS/Android) | **None for the public** | Mostly — cancel or supersede |
| **release** / **promote** | Makes it public, or advances an existing rollout's exposure | **Yes** | Web: yes. Mobile: no |

### The two invariants

> **1. `prepare` must never publish.** Producing a candidate is a private act. A prepare step that reaches a user is a bug in the pipeline, not a shortcut.
>
> **2. Production publication is always an explicit, separately-invoked operation** naming the platform and the version. It is never a side effect of merging, of a review completing, or of a previous step succeeding.

Both are violated today, in two different ways:

| Violation | Evidence | Fix |
|---|---|---|
| **Web `prepare` publishes.** Merging to `main` deploys to `play10q.com` with no separate release step. | `apps/web/package.json:17` — `"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"`, invoked by `.github/workflows/ci.yml:75-77` on push to main. `opennextjs-cloudflare deploy` builds *and starts serving* in one operation. | Split into `upload` (creates a version at 0% traffic) and an explicit promote. See [WEB.md](WEB.md). |
| **Store approval would publish**, if the default release option is taken. | Not yet applicable — no app exists. | Always choose Apple's *"Manually release this version"* and enable Google's *Managed publishing*. Both park an approved build in a holding state. |

### The artifact-identity rule

> **Promote the exact artifact you verified. Never rebuild between `submit` and `release`.**

Identifiers are inlined at build time, so a rebuild is a *different artifact* with different bytes and — if the SHA or build number moved — different identifiers. It has not been tested; it merely resembles something that was.

Each channel gives you a stable handle for this. Use it:

| Channel | Artifact handle |
|---|---|
| Web | Cloudflare **version id** (promote by id, e.g. `wrangler versions deploy <ID>@100%`) |
| iOS | **build number** (`CFBundleVersion`) attached to an App Store version |
| Android | **versionCode** in the uploaded AAB |

### 3.1 Web — Cloudflare Worker `10q-web`

| State | Meaning | Enter by | Publicly visible? | Verify at |
|---|---|---|---|---|
| `built` | `.open-next/` exists, identifiers inlined | `opennextjs-cloudflare build` | No | CI artifact |
| `uploaded` | A CF **version** exists; 0% of traffic | `opennextjs-cloudflare upload` | No | version preview URL `<prefix>-10q-web.<subdomain>.workers.dev` |
| `verified` | Smoke suite green **against that version** | run smoke against the preview URL, or deploy at 0% and pin requests with the `Cloudflare-Workers-Version-Overrides` header | No | — |
| `live` | Serving `play10q.com` | `wrangler versions deploy <ID>@100%` | **Yes** | `play10q.com` |
| `superseded` | A newer version is live | next promote | — | — |
| `rolled_back` | A previous version restored at 100% | `wrangler rollback` or `wrangler versions deploy <PREV_ID>@100%` | **Yes** | — |

Notes that matter:

- A CF *version* is a snapshot of code **and static assets** together; a *deployment* declares which version serves traffic. They are separate objects, which is exactly what makes prepare/release separable.
- Only the **last 100 versions** can be promoted or rolled back to. Rollback does not restore attached storage resources — irrelevant today, since the Worker's only binding is `ASSETS` (`apps/web/wrangler.jsonc:6-9`).
- **Percentage splits are not recommended for this Worker today.** A split serves content-hashed `/_next/static/chunks/*` from whichever version a given request happens to land on, producing chunk 404s mid-quiz — and a mid-quiz failure burns the player's one daily attempt against a 12-second server-authoritative timer. The recommended posture is **fast 100% + fast rollback**, verified on the preview URL first. Full reasoning and the conditions that would change this in [ROLLOUTS.md](ROLLOUTS.md).

### 3.2 iOS — App Store Connect

| State | Meaning | Enter by | Gate | Public? |
|---|---|---|---|---|
| `uploaded` | Binary in ASC, processing | Xcode / Transporter / `POST /v1/buildUploads` | Xcode 26+ with an iOS 26 SDK — enforced **at upload**, since 2026-04-28 | No |
| `ready_to_submit` | Processing complete | automatic | — | No |
| `internal_testing` | Available to ≤100 internal testers | add build to an internal group | **No review** | No |
| `beta_review` | Submitted for TestFlight App Review | required before external testing | ≤6 submissions per 24h; one build per version in review at a time | No |
| `external_testing` | Available to ≤10,000 external testers | approved beta review | first build gets a full review; later builds for the same version may not | No |
| `waiting_for_review` | Attached to an App Store version and submitted | Build section → select build → **Add for Review** → **Submit for Review** | one version per platform in review at a time | No |
| `in_review` | Apple is reviewing | automatic | ~90% of submissions reviewed in under 24h | No |
| `pending_developer_release` | **Approved and held** | requires release option *"Manually release this version"* | Apple emails a reminder after 30 days | No |
| `ready_for_distribution` | Live on the App Store | **explicit** Release action | up to 24h to appear | **Yes** |
| `ready_for_distribution (phased)` | Live, auto-update push throttled | enable Phased Release (**updates only**) | Day 1/2/3/4/5/6/7 = 1/2/5/10/20/50/100% | **Yes** |

Corrections to the common mental model — all of these will bite an agent operating from intuition:

- **There is no "promote from TestFlight" action.** TestFlight and the App Store are two consumers of the same uploaded build. You attach the build to a version, then Add for Review, then Submit for Review.
- **A build flagged "TestFlight Internal Only" can never ship.** It can only go to internal groups; shipping it requires a re-upload. Check the flag before planning a release around a build.
- **An external tester group requires an internal group to exist first.**
- **TestFlight builds expire 90 days after upload** — but expiry governs TestFlight only, not App Store submission.
- **The build picker hides builds older than your last released version.** Once a version is Ready for Distribution, earlier uploads silently disappear from the list.
- **Phased release is not a traffic gate.** It throttles the silent auto-update push only: *"apps and app updates in phased release can be manually downloaded from the App Store by anyone at any time."* Never use it as a compatibility canary for a backend change.
- **Pulling the app from sale permanently forfeits phasing for that version.** As an incident response it is one-way.
- Also required before any submission succeeds: the updated **age rating questionnaire** answered (mandatory since 2026-01-31), and **EU DSA trader status** verified or the app is removed in the EU.

Detail and exact console navigation: [IOS.md](IOS.md).

### 3.3 Android — Google Play Console

| State | Meaning | Enter by | Gate | Public? |
|---|---|---|---|---|
| `uploaded` | AAB in Play, draft release | Console upload or `edits.commit` | AAB mandatory; Play App Signing required | No |
| `internal_track` | ≤100 internal testers | create internal release | *might not* be reviewed — available in minutes | No |
| `closed_testing` | ≤2,000 users per list, ≤50 lists per track | promote or create closed release | **Standard review, up to 7 days or longer** | No |
| `open_testing` | Unlimited (or ≥1,000 if capped); discoverable on Play | promote or create open release | standard review | Semi |
| `production_draft` | Production release created, held | **Managed publishing on** | — | No |
| `production_staged` | Live to a fraction of users | set `userFraction` | rollout increases are **manual only** — Play never auto-advances | **Yes** |
| `production_complete` | 100% | Manage rollout → 100% | — | **Yes** |
| `halted` | Distribution stopped | Halt rollout | users already updated **stay** on the halted version | **Yes** (partially) |

Constraints that shape the pipeline:

- **The 12-tester / 14-day gate.** A *personal* Play Console account created after 2023-11-13 must run a closed test with ≥12 testers opted in **continuously for at least 14 consecutive days**, then apply for production access and pass a human review of written answers (~7 days). Organization accounts are exempt. **This is a hard, unwaivable, multi-week gate on ever reaching production** — see [DECISION REQUIRED](#9-decision-required).
- **The first production release cannot be staged and cannot be halted.** There is no previous version to fall back to. Plan the first push accordingly.
- **Halting does not downgrade anyone.** The real remedy for a bad build is shipping a higher `versionCode`.
- **Outstanding releases block new ones:** *"You cannot create a new release when you have outstanding releases."* A stuck partial rollout jams the pipeline.
- **Managed publishing does not hold everything.** It holds full and staged rollouts, store-listing changes and app-content changes. It does **not** hold increasing an existing staged rollout to 100%, release-note edits, or testing-track membership changes.
- **Target API level 36 (Android 16) is required for new apps and all updates from 2026-08-31.** Any first submission after that date must target API 36 from day one.
- **Play Console Requirements take effect 2026-09-30:** apps must be registered and package names registered, or face removal. Decide the application id before this bites.
- `versionCode` must strictly increase across the *whole app*, not per track — a tester on a high internal-track code will not be pushed backward by a lower production code.

Detail and exact console navigation: [ANDROID.md](ANDROID.md).

### 3.4 Backend — Supabase

The backend has no review, no store, and no staged rollout. `supabase db push` and `supabase functions deploy` go to 100% of every client immediately, and both are run **by hand** today ([02-current-state.md §6](../02-current-state.md)).

That gives it exactly two states — `deployed` and `not deployed` — and one ordering rule:

> **Backend before clients, always, and only ever backward-compatible.**
>
> A backend change ships first and must remain correct for every client already in the field. A client release then *starts using* what is already there. Never the reverse: a client that ships expecting a not-yet-deployed contract is broken for its entire review-to-deploy window, and on mobile you cannot take it back.

---

## 4. Change-impact matrix

Before any release, answer one question: **which channels does this change actually affect?** A backend-only or web-only change must not trigger a mobile release, and a shared-React change must not be assumed to be web-only.

| Class | Paths | Backend | Web | iOS | Android | How it reaches users |
|---|---|---|---|---|---|---|
| **Backend-only** | `supabase/functions/**`, `supabase/migrations/**`, `supabase/config.toml` | ✅ | affects all live clients instantly | affects all installed binaries instantly | affects all installed binaries instantly | Deploy backend. **No client release.** Must satisfy §2. |
| **Web-only** | `apps/web/src/middleware.ts`, `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts`, SSR/route-handler code | — | ✅ | ✗ | ✗ | Web release only. Middleware and route handlers **do not exist** in a static export, so this code cannot affect native by construction. |
| **Shared React** | `apps/web/src/app/**`, `components/**`, `lib/**`, `domains/**`, `packages/contracts/**` | — | ✅ next web release | ✅ **requires a new binary** | ✅ **requires a new binary** | Web now; mobile on the next store cycle. Expect users on all three for weeks. |
| **Native shell** | `apps/mobile/**` (`capacitor.config.ts`, `ios/`, `android/`, plugins, native permissions) | — | ✗ | ✅ | ✅ | Store release only. No web impact. |
| **Config / secrets** | `NEXT_PUBLIC_*`, CI env, Supabase dashboard settings, CF vars | — | rebuild + redeploy | rebuild + **resubmit** | rebuild + **resubmit** | `NEXT_PUBLIC_*` is inlined at build time — there is no runtime config for a shipped binary. |
| **Automation** | `.github/workflows/**`, `scripts/release/**`, `.claude/skills/release/**` | — | — | — | — | No user impact, but changes how every other row ships. Gate it like product code. |

### Classifying a diff

```bash
git diff --name-only origin/main...HEAD
```

Map the paths against the table above. Two caveats an agent will get wrong otherwise:

1. **`apps/web/src/**` is shared by default.** Assume a change there affects all three platforms unless it sits behind a platform-seam capability (see [04-shared-code-architecture.md §The platform seam](../04-shared-code-architecture.md)). "It's in `apps/web`, so it's web-only" is the single most likely misclassification.
2. **A backend change with no client diff is still a release.** It is the highest-risk class in this table precisely because it has no artifact and no review — it just becomes true for everyone, including binaries you cannot update.

---

## 5. The four pillars

Release engineering here rests on four pillars that are only useful *interlocked*. Each one gates or feeds the next.

```text
   OBSERVABILITY  ──stamps──►  every artifact carries the same 5 identifiers
         │                     into BOTH PostHog and Sentry
         │
         ▼
     TESTING      ──gates──►   the transition between states
         │                     (not "the commit" — the state transition)
         │
         ▼
   DISTRIBUTION   ──executes──►  the channel-specific mechanics
         │                       (CF versions / TestFlight / Play tracks)
         │
         ▼
    AUTOMATION    ──operates──►  scripts/release/ + .claude/skills/release/
                                 one operator, no ad-hoc console clicking
```

### 5.1 Observability — the stamp

**Every release stamps the same five identifiers into both PostHog and Sentry.** This is the contract that makes every other pillar computable. Full spec in [OBSERVABILITY.md](../OBSERVABILITY.md).

| Identifier | Web | iOS | Android |
|---|---|---|---|
| `release_sha` | `git rev-parse --short HEAD` at build | same | same |
| `client_platform` | `web` | `ios` | `android` |
| `app_version` | version source of truth ([VERSIONING.md](VERSIONING.md)) | → `CFBundleShortVersionString` | → `versionName` |
| `app_build` | build counter / CF version id | → `CFBundleVersion` | → `versionCode` |
| `environment` | `production` \| `staging` \| `development` | same | same |

They land as PostHog **super properties** (registered once at init — all 16 events already route through the single `capture()` helper at `apps/web/src/lib/analytics.ts:14-21`, so no call sites change) and as Sentry `release` + `dist` + a `client_platform` tag.

Three rules that are easy to get wrong:

- **`release`+`dist` together, not `release` alone.** The same `app_version` can have several builds; a rejected build that was uploaded still consumed its number. Sentry needs the pair to symbolicate a mobile crash.
- **Never fork `distinct_id` by platform.** One human playing on web and iOS is one person emitting events with two `client_platform` values.
- **Archive the bundle and sourcemaps per store version.** A crash arriving today may come from a binary reviewed four months ago; the branch has long since moved.

Without the stamp: promotion gates cannot be computed, field deprecation cannot be measured, and a mobile crash cannot be attributed to a build. It is the prerequisite, not the polish.

### 5.2 Testing — gates state transitions

Testing gates **transitions**, not commits. The same suite means different things at different edges.

| Transition | Gate | Runs against |
|---|---|---|
| commit → `built` | lint, typecheck, unit (`apps/web` 62 tests, `packages/contracts` 46), contract-drift check, **RLS suite**, both build targets (`opennextjs-cloudflare build` **and** `output: 'export'`) | source |
| `built` → `uploaded` | identifiers resolve and are non-empty; artifact parity (CI built the same thing production ships) | artifact |
| `uploaded` → `verified` | E2E smoke against the **actual artifact** — web: the CF version preview URL; native: the exact IPA/AAB on a real device or emulator | artifact |
| `verified` → `live` / `submitted` | preflight: clean tree, branch current, credentials present, gates green | environment |
| rollout step *n* → *n+1* | the **promotion gate** (§7) | production telemetry |

The current state of these gates is grim and must be read before trusting any of them: `supabase/tests` (~85 tests, all RLS coverage) **never runs** — it is not in the root `workspaces` array, it is stale, and it hardcodes the production URL and anon key as defaults. E2E is 4 shallow assertions in 3 files with **zero auth coverage** (`auth.spec.ts` is a verbatim duplicate of the home-title test), on one project (Desktop Chrome) — **no WebKit, no mobile viewport**, which are precisely the two configurations Capacitor runs in. See [03-blocking-fixes.md §A5](../03-blocking-fixes.md) and [TESTING.md](../TESTING.md).

### 5.3 Distribution

The channel mechanics of §3. Owned per-channel by [WEB.md](WEB.md), [IOS.md](IOS.md), [ANDROID.md](ANDROID.md); rollout and rollback semantics by [ROLLOUTS.md](ROLLOUTS.md) and [ROLLBACKS.md](ROLLBACKS.md).

### 5.4 Automation — the release skill is the operator

`.claude/skills/release/SKILL.md` is the single operator for all of this, backed by `scripts/release/`. Its non-negotiable rules — never collapse the verbs, never publish on inferred intent, gates are not advisory, backend before clients, hand off what needs a human — are the enforcement layer for this document.

> **Rule: every state transition has a named command.** Nobody runs `wrangler`, `fastlane` or a console click ad hoc. If a transition genuinely requires a human (Apple ID sign-in, signing material, store console session, expedite request, App Review appeal), the skill **says so explicitly and hands off**, naming what it needs back. It does not improvise.

---

## 6. Promotion gates

A **promotion gate** is the check that runs after a staged step and before increasing exposure. It is the only thing standing between a bad build and everyone, on the two channels where "everyone" cannot be undone.

### The shape of the check

```ts
type GateInput = {
  platform:  'web' | 'ios' | 'android';
  release:   string;   // "10q@1.4.0"          — matches Sentry `release`
  dist:      string;   // "42"                  — matches Sentry `dist`
  window:    { since: string; until: string };  // observation window
  baseline:  { release: string; dist: string }; // the release being replaced
};

type GateResult = {
  decision: 'promote' | 'hold' | 'rollback';
  checks: Array<{
    name: string;
    source: 'sentry' | 'posthog';
    value: number;
    baseline: number;
    threshold: string;
    pass: boolean;
  }>;
};
```

Every check is filtered by `client_platform` **and** `app_version` **and** `app_build`, and compared against **the previous release's same-length window** — not an absolute number. Absolute thresholds are meaningless on a product whose traffic is a daily spike.

| Check | Source | Compares | Default threshold | On failure |
|---|---|---|---|---|
| `crash_free_sessions` | Sentry | `release` + `dist` + `environment` | ≥ baseline − 0.5pp **and** ≥ 99.0% | **rollback** |
| `new_issues` | Sentry | issues first seen in window on this release | zero `error`-level issues affecting > 0.5% of sessions | hold |
| `game_starts` | PostHog | `game_start` count, per eligible user | ≥ 80% of baseline rate | hold |
| `completion_rate` | PostHog | completed ÷ started | ≥ baseline − 3pp | **rollback** |
| `auth_failure_rate` | PostHog + Sentry | auth errors ÷ sign-in attempts | ≤ baseline + 1pp | **rollback** |
| `sample_size` | PostHog | `game_start` count on the new build | ≥ minimum sample | **hold — never promote** |

Two guards that matter more than the thresholds:

1. **Insufficient signal is never a pass.** If the new build has not been exercised by enough sessions, the gate returns `hold`, not `promote`. "Nothing broke" and "nothing happened" look identical otherwise.
2. **The window must span at least one daily play spike.** 10Q's traffic is concentrated in a daily cohort. A gate evaluated off-peak sees too few sessions to be informative regardless of the percentage.

### The operator's output

The release skill prints the gate as a block and **asks** — it never promotes automatically because signals look fine:

```text
Play rollout:       10%
Sentry
  crash-free rate   99.4%  (prev release 99.5%)
  new issues        0 significant
PostHog
  game starts       normal
  completion rate   normal
  auth failures     normal
→ Safe to promote to 50%?
```

### What the gate can and cannot do per channel

| | Web | iOS | Android |
|---|---|---|---|
| Staged exposure exists? | Yes (CF split) — **not recommended today**, see §3.1 | Phased release: **auto-update push only, not a traffic gate** | Staged rollout `userFraction`: a real fraction |
| Can hold after approval? | n/a | Yes — *Manually release this version* → Pending Developer Release | Yes — Managed publishing |
| First release stageable? | n/a | **No** — updates only | **No** — first production release goes to 100% |
| Gate failure → undo | `wrangler rollback`, seconds | **None.** Pause the phased release; forward-fix through review (expedite if genuinely critical) | Halt the rollout: stops new installs, **does not downgrade** |
| Real fix for a bad build | rollback | a new build through review | a higher `versionCode` |
| Kill switch that works on a shipped binary | redeploy | **PostHog feature flag** or the minimum-version gate | **PostHog feature flag** or the minimum-version gate |

> **The last row is the architectural point.** Because a shipped store binary cannot be rolled back, the only levers that reach it are **server-side**: a feature flag, a backend change, or the minimum-supported-version gate. PostHog feature flags are at **zero usage today** ([OBSERVABILITY.md](../OBSERVABILITY.md)). Any feature that could need to be switched off after shipping must be behind a flag *in the binary that ships it* — same structural constraint as the force-upgrade screen in §2.

---

## 7. Capacitor OTA — explicitly deferred

**Not part of V1. Do not design around it.** V1 is: web → normal deploy, iOS → TestFlight/App Store, Android → Play tracks. This section exists so a future reader does not have to re-derive the legal position.

**The current rule, correctly sourced.** Guideline 2.5.2 prohibits apps that *"download, install, or execute code which introduces or changes features or functionality of the app."* The load-bearing phrase is **"introduces or changes features or functionality"** — revising web assets so the reviewed product renders better is not what it targets; shipping a new screen through that channel is.

**Correction to the near-universal citation.** Almost every OTA article cites Apple Developer Program License Agreement §3.3.2 and its carve-out for *"scripts and code downloaded and run by Apple's built-in WebKit framework or JavascriptCore."* **That clause no longer exists.** In the current agreement it is renumbered §3.3.1(B) and the WebKit/JavascriptCore language has been removed entirely. The permission is now framework-agnostic and conditional: interpreted code may be downloaded only if it (a) does not change the app's primary purpose or add functionality inconsistent with what was submitted and advertised, (b) does not bypass signing, the sandbox or OS security features, and (c) does not create a store or storefront for other applications. The conditions are conjunctive, and (a) is judged against the app **as submitted**.

**Net rule:** *OTA may fix and refine what was reviewed. It may never add what was not.*

Also applicable: Guideline **4.2.3(ii)** — if the shipped bundle downloads resources to function on first launch, you must disclose the download size and prompt the user first.

**The costs, which are the actual reason it is deferred:**

- It creates a **fourth release channel** with its own version skew, layered on top of the three in §1.
- It breaks the artifact-identity rule (§3) unless every OTA bundle restamps `app_build` and uploads its own sourcemaps — otherwise a Sentry `release`/`dist` pair no longer identifies the code that ran.
- It puts the burden of *"is this a fix or a feature?"* on an engineer's judgement, per change, forever, with app removal as the downside.

Revisit only with a written policy for that last point.

---

## 8. What does not exist yet

Everything in this table is a prerequisite. An agent that assumes any of it is present will produce confident, wrong output.

| Prerequisite | Status | Evidence | Owned by |
|---|---|---|---|
| **Version source of truth** | Missing | all three `package.json` say `0.1.0` and never move | [VERSIONING.md](VERSIONING.md) |
| **Git tags** | **Zero, ever** | `git tag` returns nothing | [VERSIONING.md](VERSIONING.md) |
| CHANGELOG / release workflow / changesets | Missing | `.github/workflows/ci.yml` is the only workflow in the repo | [VERSIONING.md](VERSIONING.md) |
| **A non-production environment** | **Missing entirely** | `apps/web/wrangler.jsonc` has no `[env.*]` blocks, no vars, no bindings; one Supabase project; Sentry `environment: process.env.NODE_ENV` → always `production`; one PostHog key (local dev writes to prod) | [05-migration-plan.md Phase 2](../05-migration-plan.md) |
| **`prepare` ≠ `release` for web** | Violated | `apps/web/package.json:17` + `.github/workflows/ci.yml:75-77` — merge to `main` publishes to `play10q.com` | [WEB.md](WEB.md) |
| **`X-Client-Version` header** | Missing | no occurrence in the repo; `supabase/functions/_shared/cors.ts:11-13` would reject it at preflight | §2 / [WEB.md](WEB.md) |
| **Min-supported-version gate** | Missing | no `UPGRADE_REQUIRED` in `packages/contracts/src/errors.ts` or `supabase/functions/_shared/response.ts` | §2 |
| **Force-upgrade screen** | Missing | no such route or component | §2 — **first-binary blocker** |
| **Supabase in CI** | Missing | no Supabase step in `.github/workflows/ci.yml`; 22 functions + migrations deployed by hand | [03-blocking-fixes.md §A5](../03-blocking-fixes.md) |
| **CI/deploy artifact parity** | **Broken** | `NEXT_PUBLIC_POSTHOG_KEY`/`HOST` are supplied to the deploy job (`ci.yml:85-86`) but not the CI build job (`ci.yml:38-44`); `NEXT_PUBLIC_*` is inlined at build time, so CI verifies a build with analytics compiled out | §5.2 |
| Sentry `release` / `dist` / `environment` | Missing | three inits share one DSN, none sets `release`; `environment` is `NODE_ENV` | [OBSERVABILITY.md](../OBSERVABILITY.md) |
| PostHog platform dimension | Missing | no super properties registered | [OBSERVABILITY.md](../OBSERVABILITY.md) |
| PostHog feature flags | Zero usage | — | §6 (the only mobile kill switch) |
| **Any Capacitor project** | Absent | no `capacitor.config.*`, no `ios/`, no `android/`, no `@capacitor/*` dependency, no AASA file, no `assetlinks.json` | [05-migration-plan.md Phase 5](../05-migration-plan.md) |
| `scripts/release/preflight`, `verify` | Not written | referenced by `.claude/skills/release/SKILL.md` | §5.4 |
| Apple / Google developer accounts | Unknown to this repo | — | [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) |

> **If you find `docs/DEPLOYMENT.md`, ignore it.** It predates the current architecture and describes deploying to Vercel. Web deployment is Cloudflare Workers via OpenNext — see [WEB.md](WEB.md).

---

## 9. DECISION REQUIRED

These are **not decided**. Do not invent a value; ask, then record the answer in the doc named.

| # | Decision | Blocks | Notes | Record in |
|---|---|---|---|---|
| 1 | **Bundle id / application id** | `npx cap init`, every signing artifact, both store listings | Permanent on Play, and must be registered under the Play Console Requirements effective 2026-09-30. Do not guess a reverse-DNS name. | [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) |
| 2 | **App name / store display name** | store listings, `capacitor.config.ts` | Distinct from the domain `play10q.com` | [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) |
| 3 | **Apple Team ID + who holds the Account Holder role** | signing, TestFlight, all submissions | **Human required.** Enrollment has real lead time and blocks nothing else — start it early. | [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) |
| 4 | **Play account type: personal or organization** | whether the **12-tester / 14-consecutive-day** closed-test gate applies before production is reachable at all | The single largest schedule risk on Android. An organization account needs a D-U-N-S number. | [ANDROID.md](ANDROID.md) |
| 5 | **`app_build` numbering scheme** | Sentry `dist`, `CFBundleVersion`, `versionCode` | Must be monotonic, shared across platforms, never reused — a rejected upload still consumed its number | [VERSIONING.md](VERSIONING.md) |
| 6 | **Staging environment shape** | every gate that needs a non-production target | Second Supabase project vs branch; second CF worker; second PostHog project vs an `environment` property | [05-migration-plan.md Phase 2](../05-migration-plan.md) |
| 7 | **Where the minimum-supported-version table lives** | the gate in §2 | DB config table (changeable without a deploy) vs Edge Function env var (simpler, needs a redeploy) | §2 / [VERSIONING.md](VERSIONING.md) |
| 8 | **Promotion gate thresholds + observation window** | §6 — the numbers above are placeholders | Cannot be set correctly until real per-platform baselines exist | [ROLLOUTS.md](ROLLOUTS.md) |
| 9 | **Deprecation threshold** — what share of clients on an old field is acceptable before removing it | §2 Phase 4 | Unanswerable until the identifier stamp lands | §2 |
| 10 | Whether web sends `X-Client-Version` from day one | version-distribution visibility | Recommended: **yes** | §2 |

---

## 10. Sibling documents

| Doc | Owns |
|---|---|
| [VERSIONING.md](VERSIONING.md) | Version source of truth, build numbers, tags, how the five identifiers are derived |
| [WEB.md](WEB.md) | Cloudflare Worker prepare/verify/promote, preview URLs, version overrides |
| [IOS.md](IOS.md) | Xcode build, TestFlight, App Store Connect submission and release |
| [ANDROID.md](ANDROID.md) | Gradle build, Play App Signing, tracks, staged rollout, managed publishing |
| [ROLLOUTS.md](ROLLOUTS.md) | Staged-rollout strategy per channel, promotion-gate queries, when to change the web posture |
| [ROLLBACKS.md](ROLLBACKS.md) | Incident response, the rollback asymmetry, kill switches |
| [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) | The one-time path to a first iOS and Android release, including everything that needs a human |

Context outside `release/`:

| Doc | Relevance |
|---|---|
| [../01-architecture-decision.md](../01-architecture-decision.md) | Why Capacitor, and the version tail this document exists to manage |
| [../02-current-state.md](../02-current-state.md) | The audit evidence behind every "does not exist" claim here |
| [../03-blocking-fixes.md](../03-blocking-fixes.md) | Security and correctness work that must land **before** any external build exists |
| [../04-shared-code-architecture.md](../04-shared-code-architecture.md) | The platform seam — what makes a change shared vs platform-specific (§4) |
| [../05-migration-plan.md](../05-migration-plan.md) | Phase 2 builds the prerequisites in §8; Phase 9 builds this machinery |
| [../OBSERVABILITY.md](../OBSERVABILITY.md) | The five identifiers, PostHog super properties, Sentry `release`/`dist` |
| [../STORE_READINESS.md](../STORE_READINESS.md) | Apple and Google compliance blockers independent of release mechanics |
| [../TESTING.md](../TESTING.md) | The gate table referenced in §5.2 |
| `.claude/skills/release/SKILL.md` | The operator that executes this state machine |
