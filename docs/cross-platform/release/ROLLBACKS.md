# Rollbacks — Undoing a Release on Three Channels That Do Not Behave Alike

**The one thing to internalize:** rollback is a *web* concept. On web it is real, cheap, and takes about ninety seconds. On iOS and Android **it does not exist** — you cannot remove code from a device someone already installed it on. Every mobile "rollback" in this document is actually one of four things: stopping *further* spread, changing behavior remotely, shipping a *new* version forward, or refusing to serve the old one.

That asymmetry is not a gap to be closed. It is a permanent property of store distribution, and it is the reason the rollout policy in [ROLLOUTS.md](ROLLOUTS.md) is strict in a way that would look paranoid for a web-only product.

| Channel | Can you undo a bad release? | Fastest lever | Time to effect |
|---|---|---|---|
| **Web** (Cloudflare Worker `10q-web`) | **Yes — genuinely.** Previous version is a single command away | `wrangler rollback` | **~60–90 s** |
| **iOS** | **No.** Installed binaries stay installed, forever | PostHog feature flag kill switch | seconds–minutes |
| **Android** | **No.** Same | PostHog feature flag kill switch | seconds–minutes |
| **Supabase** (22 Edge Functions + 14 migrations) | **Functions: yes, by redeploying from git.** **Migrations: no — forward-only** | `supabase functions deploy <name>` from a known-good tree | ~1 min |

**Corollary that governs everything below:** because Supabase reaches *every* client on *every* platform at *every* version, it is simultaneously the fastest way to mitigate a mobile incident and the fastest way to cause one. See [Supabase](#supabase-rollback--functions-yes-migrations-no).

---

## Prerequisites — none of this works today

This runbook assumes identifiers that **do not exist in the repo as of `af86e61`**. Do not attempt to execute it before [VERSIONING.md](VERSIONING.md) lands.

| Needed for | What is missing today | Evidence |
|---|---|---|
| Knowing *which* client versions are broken | `release_sha`, `client_platform`, `app_version`, `app_build`, `environment` on every Sentry event and PostHog event | Zero git tags ever; all three `package.json` files pinned at `0.1.0`; `apps/web/src/lib/posthog.ts:17-20` registers no super properties; no Sentry `release` or `dist` is set anywhere |
| Knowing which Worker version is live | Nothing stamps a build id into a response the client, Sentry, or PostHog can read | No `version_metadata` binding in `apps/web/wrangler.jsonc` |
| The kill-switch lever | Zero PostHog feature flags in use | Repo-wide: no `isFeatureEnabled` / `onFeatureFlags` call sites |
| The force-upgrade lever | No client version header, no minimum-version check | `callEdgeFunction` builds headers at `apps/web/src/lib/api/edge-functions.ts:41-42` — `Content-Type` only |
| Telling staging from production during an incident | **Only production exists**, everywhere | `apps/web/wrangler.jsonc` has zero `[env.*]` blocks; one Supabase project; Sentry `environment` is `process.env.NODE_ENV`; one PostHog key |

Until those land, the only functioning lever in this entire document is the Cloudflare Worker rollback — which is precisely why it is the first section.

> ⚠️ **[docs/DEPLOYMENT.md](../../DEPLOYMENT.md) has a "Rollback Procedure" section that is wrong.** It names Vercel (the real target is Cloudflare Workers via OpenNext), and it documents two CLI flags that do not exist: `supabase db push --version <target>` and `supabase functions deploy <name> --version <previous>`. It also suggests `supabase db reset`, which is destructive. **This document supersedes it.** Do not follow it in an incident.

---

## Web rollback — the fastest lever you have

### Why it is genuinely safe here

Cloudflare's documented rollback blockers are *bindings changed or deleted* and *Durable Object class lifecycle changes*. Neither can apply to this Worker:

```jsonc
// apps/web/wrangler.jsonc
{
  "name": "10q-web",
  "main": ".open-next/worker.js",
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "routes": [ { "pattern": "play10q.com/*", ... }, { "pattern": "www.play10q.com/*", ... } ]
}
```

`ASSETS` is the only binding. There is no KV, D1, R2, Queue, or Durable Object. Three consequences, all favorable:

1. **Rollback is never blocked** by a binding or DO-lifecycle change.
2. **A version snapshot includes the static assets**, so rolling back restores a self-consistent code + `/_next/static/*` pair. You cannot end up with old HTML referencing chunk hashes that no longer exist.
3. **Browsers stop serving the bad HTML immediately.** `apps/web/src/middleware.ts:34` sets `Cache-Control: no-store` on every non-asset response, and the matcher at `:41` excludes `_next/static`, `_next/image`, `favicon.ico` and image extensions — so HTML is uncached and content-hashed assets are immutable-and-therefore-harmless.

**Rollback does not restore data.** Cloudflare is explicit: connected resources are unchanged. This Worker has no connected storage, so in practice that caveat lands on Supabase, not here — anything the bad version *wrote* to Postgres stays written. Rolling back the Worker does not un-corrupt an `attempts` row.

**Only the last 100 uploaded versions are rollback targets.** At today's cadence that is many months of headroom, but it is a real ceiling.

### Procedure

All commands run from `/Users/rocky/Code/10q-app/apps/web` — that is where `wrangler.jsonc` lives, and `wrangler ^4.71.0` is a devDependency there (`apps/web/package.json`). Add `--name 10q-web` if you run them from anywhere else.

You need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your shell. Today those exist **only as GitHub Actions secrets** (`.github/workflows/ci.yml:87-88`) — see [DECISION REQUIRED](#decision-required).

```bash
cd /Users/rocky/Code/10q-app/apps/web

# 1. What is live right now, and what preceded it.
npx wrangler deployments status
npx wrangler versions list

# 2. Roll back one version. Defaults to the version preceding the active one.
npx wrangler rollback --message "incident: <one line, e.g. quiz page white-screens on iOS Safari>"

# 2b. Or roll back to a specific version — use this when the previous version
#     is ALSO bad, or when you have already rolled back once.
npx wrangler versions deploy <VERSION_ID>@100%
```

`wrangler rollback` prompts for confirmation and a message; `--message` supplies the message but you still confirm. `wrangler versions deploy` accepts `--yes` for non-interactive use.

**Rolling back from a gradual deployment collapses the split** into a single version at 100%. That is the desired behavior in an incident.

### Verification — do not skip this

The rollback is not done when the command exits. It is done when you have confirmed the origin is serving the old bundle and the error signature has stopped.

```bash
# 1. Cloudflare agrees the intended version is active.
npx wrangler deployments status

# 2. The edge is actually serving the old bundle.
#    Today's only usable fingerprint is the Next build id in the asset paths —
#    it changes on every build, so it differing from the bad deploy's id is proof.
curl -s https://play10q.com/ | grep -o '/_next/static/[A-Za-z0-9_-]\{6,\}/' | head -1

# 3. HTML is still uncached, so no browser is pinned to the bad version.
curl -sI https://play10q.com/ | grep -i '^cache-control'
#    expect: cache-control: no-store    (from middleware.ts:34)

# 4. The app actually works: home renders, /play reachable, a question advances.
#    This is the same ground the 4 Playwright e2e assertions cover and no more —
#    the click-through is not optional.
```

Then watch the signal, not the console: the Sentry issue's event rate must fall to zero within a couple of minutes, and the PostHog error/abandon events must return to baseline. **Once `release_sha` is stamped ([OBSERVABILITY.md](../OBSERVABILITY.md)), step 2 becomes a one-line check against the expected SHA instead of a build-id diff.**

You do **not** normally need a cache purge. HTML is `no-store`; assets are content-hashed, so any newer assets still sitting in the edge cache are simply never requested again. If you purge anyway, purge everything from the Cloudflare dashboard (Caching → Configuration → Purge Everything) — selective purging of hashed asset paths is busywork.

### The step people forget: revert `main`

`.github/workflows/ci.yml:56-59` deploys on **every** push to `main`, running `npm run deploy` in `apps/web` (`:75-77`), which is `opennextjs-cloudflare build && opennextjs-cloudflare deploy` — build a new version *and* send it to 100% in one step.

So a Worker rollback is **temporary by construction**. The next merge to `main` re-ships whatever `main` contains. The Worker rollback buys you time; it does not fix the repo.

```bash
# Stop the bleeding at the source while you investigate.
gh workflow disable CI --repo rileycevans/10q-app

# Then either revert the offending commit on main, or fix forward on a branch.
git revert --no-edit <BAD_SHA>

# Re-enable once main is known-good.
gh workflow enable CI --repo rileycevans/10q-app
```

Disabling the workflow also disables PR checks. Prefer it for a live incident; prefer "just don't merge" for anything less urgent.

### One structural improvement worth making before you need it

`npm run deploy` couples "create a version" to "serve it to everyone." Splitting them costs nothing and lets you validate on production infrastructure before any user is exposed:

```bash
# create the version WITHOUT serving it
npx opennextjs-cloudflare build && npx opennextjs-cloudflare upload

# smoke-test it via its preview URL (workers_dev is true in wrangler.jsonc,
# so preview URLs are enabled), then promote:
npx wrangler versions deploy <NEW_VERSION_ID>@100%
```

This is a [ROLLOUTS.md](ROLLOUTS.md) concern, not a rollback one, but it is the single change that most reduces how often this document gets used. **Note it is not a traffic split** — see ROLLOUTS.md for why percentage-based gradual deployment is *not* recommended for this Worker as currently configured (content-hashed `/_next/static/*` chunks would be split across versions and 404).

---

## iOS and Android — you cannot roll back

**Say this plainly to anyone who asks for a mobile rollback: there is no mechanism, on either store, to remove or downgrade code on a device that already has it.** Not halting, not unpublishing, not pulling the app from sale. A user running the bad build keeps running the bad build until *they* install something newer.

Everything below is a mitigation with a different shape.

### The levers, in order of speed

| # | Lever | Time to effect | Reaches | Needs a human? |
|---|---|---|---|---|
| 1 | **PostHog feature flag kill switch** | seconds → next app launch | Every installed binary **that shipped with the flag** | No (API/UI), but only if the flag was built in advance |
| 2 | **Server-side compensation** in an Edge Function | ~1 min (`supabase functions deploy`) | **Every client, every version, both platforms** | No |
| 3 | **Halt / pause the rollout** | minutes | Only users who have **not yet** updated | Yes — store console role |
| 4 | **Forward fix — Android** | hours → 7 days (review) | Only users who update | Partly |
| 5 | **Forward fix — iOS** | ~24 h typical; expedite is a web form | Only users who update | Yes — expedite request |
| 6 | **Minimum-supported-version force-upgrade gate** | next launch, for binaries that shipped the gate | Every client with the gate | No |
| 7 | *Remove from sale* — **not a rollback** | hours; stops new installs only | Nobody already installed | Yes, and see the warning below |
| — | *Capacitor OTA / live updates* | **Deferred — not available in V1.** See [below](#ota-updates--explicitly-deferred) | — | — |

Note the ordering: **the two fastest levers are the two that do not involve a store at all.** That is not a coincidence, and it is the whole design argument for feature flags and for keeping game authority in Edge Functions.

### 1. Feature flag kill switch (PostHog) — the only sub-review lever

This is the only mechanism that changes the behavior of an *already-installed* binary in under a minute. It exists **only if you shipped the flag check inside that binary.** A flag added after the bad build shipped is worthless for that build.

PostHog usage today is **zero flags** ([OBSERVABILITY.md](../OBSERVABILITY.md)). The rule that makes this lever real:

> **Anything that could plausibly need to be switched off remotely must ship behind a flag from the first native build onward.** The cost is a boolean; the alternative is a seven-day store review.

Operationally, when you kill a flag:

- Roll the flag to **0%** for the affected `client_platform` / `app_version` cohort. Do not delete the flag — deletion makes the client fall to its hardcoded default, which may be *on*.
- Flags evaluate on the client at init and on refresh. **Latency to a user mid-session is a poll interval; to a backgrounded app it is the next launch.** Budget minutes, not seconds, for full propagation.
- **Decide the offline/failure default deliberately** and write it next to the flag. A native app opened on a plane cannot reach PostHog. A kill switch that fails *open* is not a kill switch. This is a [DECISION REQUIRED](#decision-required) item.

### 2. Server-side compensation — the lever that actually gets used

Every piece of game authority lives in Supabase Edge Functions (`supabase/functions/`, 22 of them), not in the client and not in the Worker. That means a very large class of mobile bugs can be neutralized without touching the client at all: widen a validation, tolerate a field the bad build sends wrong, ignore a malformed value, return a compatible shape.

This is **the** mitigation for a version-skew incident, and it is why the contract rule in [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) is what it is. See [the Supabase section](#supabase-rollback--functions-yes-migrations-no) for how to do it without breaking older clients.

### 3. Halt / pause the rollout — stops spread, helps nobody already updated

**Android — halt.** Play Console → your app → **Release** → the track (Production / Open testing / Closed testing / Internal testing) → **Releases** → the release → **Manage rollout** → **Halt rollout**.

- Halting works even on a release already at **100%**, on every track except internal. The previously live version automatically becomes the fallback for new and eligible users. It cannot be a version with policy violations.
- **Users already on the halted version keep it.** Halting is not a remote uninstall and not a forced downgrade.
- **You cannot halt a first release on a track** — there is no previous version to fall back to. Your first production push has no percentage valve and no halt. Plan it accordingly.
- Google's own guidance: if the release has been out a while or most users already took it, halting "might not be the most effective solution." The real fix is a higher `versionCode`.
- Resuming reuses the **same cohort**, not a fresh random sample.
- API equivalent: Android Publisher v3 `edits.tracks.patch` with `releases[].status = "halted"`. Note **only one edit may be open per user** — a human poking Play Console invalidates an in-flight API edit, which is a genuine source of flaky automation.

**iOS — pause phased release.** App Store Connect → **Apps** → 10Q → the version → **Phased Release for Automatic Updates** → **Pause Phased Release** → **Save**.

- Phased release runs 1 / 2 / 5 / 10 / 20 / 50 / 100 % on days 1–7. It is **updates only, never a first release.**
- You may pause for up to **30 days cumulative** across any number of pauses, and resuming picks up on the day it stopped.
- **Phased release is not a traffic gate.** Apple: apps in phased release "can be manually downloaded from the App Store by anyone at any time." It throttles only the silent auto-update push. Anyone who taps Update, and every new installer, gets the new build on day 1. **Never treat a phased percentage as a bound on how many clients are hitting your backend with the new contract.**
- API equivalent: `PATCH /v1/appStoreVersionPhasedReleases/{id}` with `phasedReleaseState: PAUSED` (states: `INACTIVE`, `ACTIVE`, `PAUSED`, `COMPLETE`).

### 4–5. Forward fix through review

This is the only thing that genuinely replaces the bad code, and it reaches only the users who install it.

**iOS.** Build → upload → attach to a version → **Add for Review** → **Submit for Review**. There is no "promote from TestFlight" action — TestFlight and App Store submission are two consumers of the same uploaded build.

- 90% of submissions are reviewed in **under 24 hours**. Normal review is often faster than an expedite round-trip.
- **Expedited review** is a web form at `https://developer.apple.com/contact/app-store/?topic=expedite` — it is not in App Store Connect and not in the API. For a critical bug fix, Apple asks you to **include steps to reproduce the bug on the current version**. Grants are on a limited basis with no guarantee; overuse is reported to reduce future grants. **This step requires a human.**
- Constraints that bite during an incident: only **one app version per platform under review at a time**; **one build per version** (changeable until you submit); a build flagged **TestFlight Internal Only** at upload can never be submitted to review — you must re-upload.
- **Hard upload gate:** since April 28, 2026, uploads must be built with **Xcode 26+ against an iOS 26 SDK**, or they are rejected at upload, before review. Discovering this mid-incident is expensive.

**Android.** Upload a bundle with a **strictly higher `versionCode`** and roll it out.

- `versionCode` must strictly increase, can never be reused, and is what Play uses to decide update eligibility. `versionName` is cosmetic and plays no role.
- Closed, open and production releases go through standard review — **typically up to seven days**, longer for some accounts.
- **Blocking gotcha:** "You cannot create a new release when you have outstanding releases." A stuck partial rollout blocks the fix. Resolve or discard the outstanding release first.
- Internal test track publishes within minutes and *might* skip policy review — but not unconditionally (a prior rejection forces review even on internal). Do not architect the emergency path around internal-track speed.

### 6. Minimum-supported-version force-upgrade gate — the blunt last resort

The one lever that can categorically stop a bad binary from touching the backend. It is also user-hostile: it hard-blocks play until the user updates from the store, which itself takes review latency to make available.

**It does not exist today.** Building it (Phase 2 of [05-migration-plan.md](../05-migration-plan.md)) requires two halves:

- **Client half.** Send the version on every request. The choke point already exists: `callEdgeFunction` in `apps/web/src/lib/api/edge-functions.ts:18`, whose header block is `:41-42`. Add `X-Client-Platform` / `X-Client-Version` / `X-Client-Build` there and every one of the 22 endpoints gets it for free.
- **Server half.** Compare against a minimum in `supabase/functions/_shared/` and return a distinct, typed error the client renders as a blocking upgrade screen. Note `ErrorCodes` in `supabase/functions/_shared/response.ts:8-24` has **no code for this** — one must be added, in both that file and `packages/contracts/src/errors.ts`, or you repeat the `ErrorCodes.INVALID_ANSWER` bug in [03-blocking-fixes.md C5](../03-blocking-fixes.md) where the code is `undefined` at runtime and cannot be alerted on.

Two properties to design in from the start:

1. **The minimum must be changeable without a deploy** — a row in Postgres, not a constant in a function. In an incident you want to raise the floor in seconds.
2. **The gate only protects versions that shipped with it.** It cannot retroactively gate v1.0 if the gate landed in v1.1. Ship it in the first store build or it is worth nothing for the versions most likely to need it.

### 7. Removing the app from sale is not a rollback

It stops new installs. It does nothing to installed binaries. And on iOS it carries a **permanent** cost: removing the app from sale — including a lapsed Apple Developer Program membership — **stops phased release and makes it unavailable for that version forever.** On reinstatement the version goes to all users immediately, at whatever percentage it had reached. Recovering a controlled rollout requires making the version unavailable and submitting a *new* version with phasing enabled.

Reserve this for legal or safety emergencies, never for a bug.

### OTA updates — explicitly deferred

Capacitor live updates (Appflow or equivalent) would collapse the mobile lever list to something close to the web one. **It is out of scope for V1.** V1 is: web → normal deploy, iOS → TestFlight/App Store, Android → Play testing/production.

If it is ever revisited, the current rules are:

- **Guideline 2.5.2** prohibits downloading code that "introduces or changes features or functionality of the app." The operative test is *features and functionality*, not the file format. Shipping revised web assets that render the product a reviewer already approved is not the target; shipping a new screen or new capability through the OTA channel is.
- The widely-cited Developer Program License Agreement §3.3.2 carve-out for "code run by Apple's built-in WebKit framework" **no longer exists.** The current agreement renumbers it to **§3.3.1(B)** and has removed the WebKit/JavascriptCore language entirely. Interpreted code may be downloaded only if it (a) does not change the app's primary purpose or add functionality inconsistent with what was submitted and advertised, (b) does not bypass signing, sandbox, or OS security, and (c) does not create a store or storefront. **Conditions are conjunctive**, and (a) is judged against the app *as submitted*.
- **Guideline 4.2.3(ii)** additionally requires disclosing the download size and prompting the user if the app fetches resources it needs to function on first launch.

Costs to price in: an update-server dependency, a second artifact to version and archive per store version (which breaks the clean `release`/`dist` pairing in [OBSERVABILITY.md](../OBSERVABILITY.md)), and review risk on every OTA payload that is more than a fix.

---

## Because mobile cannot roll back, the mitigation is upstream

This is the actual conclusion of the previous section, and it deserves to be stated on its own.

**You do not get a second chance on mobile. So the investment goes before the release, not after it.** Four mechanisms, in descending order of how much incident they prevent:

1. **Staged rollout, always.** Android staged rollout at a small `userFraction`; iOS phased release on every update. Neither is a rollback, but both bound the population you cannot help. Remember the two holes: Apple's phased release does not stop manual downloads, and neither platform offers staging or halting on a **first** release.
2. **Soak in TestFlight / Play internal before production, every time.** TestFlight internal testers (up to 100, App Store Connect users on your team) need **no Beta App Review** and get builds as soon as they process. External testers (up to 10,000) require TestFlight App Review — first build a full review, later builds often not — capped at **six submissions per 24 h**, one build per version in review at a time, and an external group requires an internal group to exist first. Builds expire after **90 days**. Play internal testing publishes within minutes to at most 100 testers by email list.
3. **Backward-compatible backend changes, without exception.** A store binary from four months ago is a supported client. This is the rule the whole architecture rests on — see [Supabase](#supabase-rollback--functions-yes-migrations-no) and [04-shared-code-architecture.md](../04-shared-code-architecture.md).
4. **Feature flags on anything risky.** The only lever that beats review latency. It has to be in the binary before you need it.

**One codebase does not mean one deployment channel.** Web, iOS and Android are three independently controllable channels that do not go public simultaneously — store review alone guarantees they cannot. Every API change must assume all three versions are live at once.

That is the whole justification for the rollout policy. It is not process for its own sake; it is the only compensation available for a channel with no undo button.

> **Play Console gate worth knowing now, because it changes the calendar:** personal Play Console accounts created after 2023-11-13 must run a closed test with **≥12 testers opted in continuously for ≥14 days**, then apply for production access and answer a written questionnaire (review usually ≤7 days). If 10Q's Play account is personal rather than an organization account, production is at minimum three weeks out from the first closed test. See [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md).

---

## Supabase rollback — functions yes, migrations no

Supabase is the highest-leverage and highest-risk surface in an incident, because it is the **only** thing that reaches every platform at every version simultaneously. It is also entirely un-automated: 22 Edge Functions and 14 migrations under `supabase/migrations/`, all deployed by hand (`supabase db push`, `supabase functions deploy`). There is no Supabase step in `.github/workflows/ci.yml` at all.

### Edge Functions — git is the version store

There is **no `--version` flag on `supabase functions deploy`.** ([docs/DEPLOYMENT.md](../../DEPLOYMENT.md) claims otherwise; it is wrong.) The rollback is: check out the known-good source and redeploy it.

```bash
cd /Users/rocky/Code/10q-app

# What is deployed, and when did each function last change?
supabase functions list

# Restore ONE function from a known-good commit or release tag,
# then redeploy just that one. Never redeploy all 22 during an incident.
git checkout <GOOD_SHA_OR_TAG> -- supabase/functions/submit-answer
supabase functions deploy submit-answer

# Verify against production before you look away.
curl -sX POST "$SUPABASE_URL/functions/v1/submit-answer" \
  -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{...}' | jq '.ok, .error.code, .request_id'

# Put the working tree back.
git checkout HEAD -- supabase/functions/submit-answer
```

**This is the strongest single argument for release tags.** With zero git tags in the repo's history, "the version that was deployed when the last iOS build shipped" is currently unknowable. [VERSIONING.md](VERSIONING.md) fixes this; until then, record the deploy SHA by hand every time you run `functions deploy`.

Two traps specific to this repo:

- **`_shared/` is copied into every function at deploy time.** Reverting `supabase/functions/_shared/response.ts` or `_shared/auth.ts` affects nothing until you redeploy each function that uses it. A partial revert leaves the fleet internally inconsistent.
- **Auth failures fail OPEN.** Every function runs `verify_jwt = false` (`supabase/config.toml:48-91`) because the gateway cannot validate this project's ES256 keys; each function is expected to check the Bearer token itself via `_shared/auth.ts`. **A revert that drops an in-function auth check does not 401 — it silently serves everyone under service role.** This is exactly how [03-blocking-fixes.md A1/A2](../03-blocking-fixes.md) survived. Diff auth checks explicitly before deploying any reverted function.

### Migrations — forward-only, no exceptions

`supabase db push` applies forward. There is no revert command. `supabase db reset` **drops and rebuilds the database** — against a linked production project that is a data-loss event, not a rollback. Never run it in an incident.

**The correct move is always a new, compensating migration.** Write it, review it as carefully as the original, `db push` it.

### The hard case: a migration a shipped store binary depends on

This is where mobile's lack of rollback and Postgres's lack of rollback multiply.

Concrete, from this repo's own history:

- `20260405000000_add_league_invite_code.sql` added `leagues.invite_code`, which `get-league-by-invite` and the invite flow read. Once an iOS binary that uses invite links is installed, **dropping that column breaks every installed copy, permanently, with no lever to fix them but a store release.**
- `20260310100000_restrict_is_correct_column.sql` is a single `REVOKE`/`GRANT` pair that is the *only* thing keeping the answer key hidden from the anon key ([03-blocking-fixes.md A6](../03-blocking-fixes.md)). Reverting it — or replaying migrations out of order — re-exposes the entire answer key to every client at once.
- `enforce_question_timing()` in `20250119000000_notion_schema_alignment.sql:396-410` writes a **16 s** expiry that overrides the 12 s every code path computes ([03-blocking-fixes.md C1](../03-blocking-fixes.md)). That value is read back by clients on resume. It is a live demonstration that **a database value is part of the client contract** whether or not anyone wrote it down.

**The rule:**

> **Forward-fix the backend. Never break an installed client.**
>
> A schema change is not reversible once a store binary depends on it. The reverse is also true and more common: a schema change that an *older* installed binary cannot tolerate is a production incident with no rollback on either side.

The discipline that makes this workable is expand / migrate / contract:

| Phase | Action | Safe while old clients exist? |
|---|---|---|
| **Expand** | Add the new column/table/field. Write both old and new. Nothing reads the new one yet | ✅ Yes |
| **Migrate** | New client version reads the new field. Backfill. Old clients keep using the old field | ✅ Yes |
| **Contract** | Drop the old field | ❌ **Only when the install base below the threshold is effectively zero** |

**The contract phase is gated on measurement, not on a calendar.** The gate is the PostHog query in [OBSERVABILITY.md](../OBSERVABILITY.md): count distinct users by `app_version` where `client_platform` is `ios` or `android`, over the last 30 days. If any non-trivial cohort still runs a version that needs the old field, you do not contract — you either wait or force-upgrade first. **Without the `app_version` super property, this query is impossible and you are guessing.**

Additive-only rules for Edge Function responses, same reasoning: never remove a field, never repurpose a field name, never change a field's type, never tighten a validation that an older client can trip. Adding is free; everything else is a version-skew incident waiting for the slowest-updating user.

---

## Incident runbook

### 1. Detect

Sources, in the order they usually fire:

- **Sentry** — a new issue, or an existing issue's event rate spiking. Once identifiers land, the first thing to read off the issue is the `client_platform` tag and the `release` / `dist` pair.
- **PostHog** — a funnel drop. For 10Q the diagnostic funnel is `quiz_start → question_answered ×10 → quiz_completed`; a break between two specific questions localizes the fault far better than a stack trace.
- **A human** — Riley, or a player. Treat this as a valid detector; nothing else has coverage of "the app is up but the game is wrong."

**Deliberate gap today:** Sentry `environment` is `process.env.NODE_ENV` and there is one deploy target, so *everything* is `production` and iOS, Android and web land in the same undifferentiated bucket. Until the `client_platform` tag lands, **triage cannot begin from the alert** and you must reproduce manually.

### 2. Triage — answer three questions before touching anything

**a. Which platforms?** Group the Sentry issue by the `client_platform` tag.

| Pattern | Almost certainly |
|---|---|
| Web only | Worker / OpenNext / `middleware.ts` — **web rollback applies, go fast** |
| One mobile platform only | WebView-specific, or that platform's native shell |
| All three at once | Shared React code, or an Edge Function / migration — **check what you deployed to Supabase last** |
| Mobile only, web fine | A skew problem: the mobile bundle is older than the backend it is calling |

**b. Which versions?** Filter Sentry by `release` + `dist`, and PostHog by `app_version` + `app_build`. Answer: *is the bad version one you shipped in the last hour, or one installed for weeks?* That single fact decides whether halting the rollout is useful or pointless.

**c. How many users?** Count distinct users on the affected `app_version` over the last 24 h in PostHog. If most of the affected population already updated, halting the rollout is theater — go straight to lever 1, 2, or 4/5.

### 3. Contain

Order matters. Do the cheap reversible things first.

```
1. Web affected?          → wrangler rollback              (~90 s)   ← always first
2. Mobile rollout live?   → halt Play rollout / pause iOS phased release
3. Bad code behind a flag? → set the flag to 0% in PostHog
4. Can the backend absorb it? → deploy a tolerant Edge Function
5. Disable CI on main so nothing re-ships the bad build
```

Do **not** start a store submission during containment. Contain first; the review clock runs whether or not you are still panicking, and a rushed build that fails review costs more than the ten minutes of thought.

### 4. Fix

- **Web** — revert or fix forward on `main`, re-enable CI, let it deploy, verify as in [Verification](#verification--do-not-skip-this).
- **Supabase function** — fix in the repo, deploy the single function, verify with curl, commit.
- **Supabase schema** — write a *new* compensating migration. Never revert. Never `db reset`.
- **Mobile** — bump the version, build, submit. iOS: expedite only for a genuinely critical bug and include reproduction steps. Android: bump `versionCode`; clear any outstanding release first or the new one is blocked.

### 5. Verify

The incident is over when all of these hold, not when the deploy is green:

- [ ] Sentry event rate for the issue is at zero for at least 30 minutes
- [ ] The PostHog funnel step that broke is back to its trailing-7-day baseline
- [ ] The fix is confirmed **on each affected platform**, by hand — one full quiz run each
- [ ] `main` contains the fix (not just the running deployment)
- [ ] Any halted rollout has been resumed, or deliberately abandoned in favor of a new release
- [ ] Any PostHog flag flipped during containment is either restored or explicitly left off with a note

### 6. Post-incident

Short and honest, not ceremonial. Record:

- **Timeline** — first bad deploy, detection, containment, resolution. The gap between deploy and detection is the number that matters; it is what monitoring is for.
- **Which lever worked**, and how long it actually took versus what this document claims. Correct this document.
- **Whether a flag would have helped.** If yes, that is a concrete backlog item, not a regret.
- **Whether the contract broke an older client.** If yes, the expand/migrate/contract discipline was skipped — find out where.
- **Which test would have caught it.** For 10Q this is usually a real answer: `apps/web` vitest has **zero component tests** (3 files, `node` environment, no jsdom), Playwright has **4 shallow assertions in 3 files** on Desktop Chrome only — **no WebKit project and no mobile viewport**, i.e. exactly the two configurations Capacitor runs in — and `supabase/tests` (~85 tests, all RLS coverage) **never runs at all** because `supabase/tests` is not in the root `workspaces` array. See [TESTING.md](../TESTING.md) and [03-blocking-fixes.md A5](../03-blocking-fixes.md).

---

## Decision tree

For the release skill, or a human under pressure. Follow it top to bottom; do not skip to the interesting branch.

```text
INCIDENT DETECTED
│
├─ Is production actively broken for users?
│  ├─ NO  → not an incident. Open an issue, fix on a branch, ship normally. STOP.
│  └─ YES → continue
│
├─ WHICH PLATFORMS? (Sentry tag `client_platform`; if absent, reproduce by hand)
│
├─ WEB affected? ─────────────────────────────────────────────────────────────
│  │   ALWAYS DO THIS FIRST. It is the only true rollback you own.
│  │   $ cd apps/web
│  │   $ npx wrangler deployments status         # note the active version id
│  │   $ npx wrangler rollback --message "<incident>"
│  │   $ curl -sI https://play10q.com/ | grep -i cache-control   # expect no-store
│  │   $ curl -s  https://play10q.com/ | grep -o '/_next/static/[A-Za-z0-9_-]\{6,\}/' | head -1
│  │   $ gh workflow disable CI --repo rileycevans/10q-app   # or main re-ships it
│  └─ Web restored? → yes: continue to mobile check. no: roll back further
│                     ($ npx wrangler versions deploy <OLDER_ID>@100%)
│
├─ SUPABASE the cause? (deployed a function or ran `db push` recently?) ───────
│  ├─ Edge Function → $ git checkout <GOOD_SHA> -- supabase/functions/<name>
│  │                  $ supabase functions deploy <name>
│  │                  ⚠ diff the in-function auth check first — verify_jwt=false
│  │                    means a missing check fails OPEN, not closed
│  └─ Migration     → DO NOT REVERT. DO NOT `db reset`.
│                     Write a compensating forward migration.
│                     Before applying, ask: does any INSTALLED store binary
│                     depend on the state you are about to change?
│                       yes → the change must be additive, or it is a new incident
│                       no  → proceed
│
├─ MOBILE affected? ──────────────────────────────────────────────────────────
│  │
│  ├─ Is the bad code behind a PostHog feature flag?
│  │   ├─ YES → set the flag to 0% for the affected cohort.  ~seconds–minutes.
│  │   │        DO NOT DELETE the flag — clients fall back to their built-in
│  │   │        default, which may be ON. Then STOP and verify.
│  │   └─ NO  → continue
│  │
│  ├─ Can the backend absorb the bug without a client change?
│  │   ├─ YES → deploy a tolerant Edge Function. ~1 min, reaches EVERY version
│  │   │        on BOTH platforms. This is usually the right answer.
│  │   └─ NO  → continue
│  │
│  ├─ Is a rollout still in progress?
│  │   ├─ Android → Play Console → Release → <track> → Manage rollout → Halt.
│  │   │            Works at 100% too (not on internal). Previous version becomes
│  │   │            the fallback for NEW installs only.
│  │   │            ⚠ cannot halt a FIRST release on a track.
│  │   ├─ iOS     → ASC → Apps → 10Q → <version> → Phased Release for Automatic
│  │   │            Updates → Pause Phased Release → Save. 30-day pause budget.
│  │   │            ⚠ pausing does NOT stop manual downloads.
│  │   └─ Either way: users who already updated KEEP the bad build. Continue.
│  │
│  ├─ Is the bug severe enough to justify blocking play entirely?
│  │   ├─ YES and the min-version gate shipped in this binary
│  │   │        → raise the minimum supported version. Users get a hard upgrade
│  │   │          prompt at next launch. Blunt, user-hostile, effective.
│  │   │          ⚠ only works for binaries that shipped WITH the gate.
│  │   └─ NO / gate absent → continue
│  │
│  └─ FORWARD FIX (the only real fix; everything above was mitigation)
│      ├─ Android: bump versionCode, build AAB, upload, roll out.
│      │           ⚠ clear any outstanding release first or you are blocked.
│      │           Review: hours to 7 days.
│      ├─ iOS:     bump build, upload (Xcode 26 + iOS 26 SDK or the upload is
│      │           rejected before review), attach to version, Add for Review,
│      │           Submit for Review. ~24 h typical.
│      │           Critical bug only → also file the expedite web form at
│      │           developer.apple.com/contact/app-store/?topic=expedite
│      │           and include steps to reproduce. HUMAN REQUIRED.
│      └─ Ship it staged. A hotfix at 100% is how a one-platform incident
│         becomes a two-incident day.
│
└─ VERIFY, then post-incident. Update THIS FILE with what the levers actually
   cost in wall-clock time.
```

---

## DECISION REQUIRED

Placeholders this runbook needs filled before it is executable. **Do not invent values.**

| # | Decision | Blocks | Notes |
|---|---|---|---|
| 1 | **Bundle identifier / Android package name** | Every store-console and API step | Not chosen. Also determines the Play package registration required by the Sept 30, 2026 Play Console Requirements |
| 2 | **Apple Team ID + App Store Connect app ID (`ASC_APP_ID`)** | Any App Store Connect API call, including pausing phased release | Human-provisioned |
| 3 | **App Store Connect API key** (issuer id, key id, `.p8`) and **Google Play service account JSON** | Automating halt/pause instead of clicking | Both are human-provisioned credentials. Store them as GitHub secrets, never in the repo |
| 4 | **Where a human-usable `CLOUDFLARE_API_TOKEN` lives** | The web rollback itself | Today the token exists only as a GitHub Actions secret (`ci.yml:87-88`). **An incident responder with no local token cannot roll back.** Decide: a scoped personal token in a password manager, a documented dashboard path (Workers & Pages → `10q-web` → Deployments → ⋯ → Rollback), or both |
| 5 | **Incident owner and where incidents are recorded** | Post-incident step | Single-maintainer repo today. Name the person and the destination (GitHub issue label? Confluence?) |
| 6 | **Feature-flag conventions**: naming, default-when-unreachable, and whether kill switches are default-on or default-off | Lever 1, the only sub-review lever | A native app offline cannot reach PostHog. A kill switch that fails open is not a kill switch |
| 7 | **Minimum-version transport and storage**: request header vs. a field on an existing response; DB row vs. env var | Lever 6 | Must be changeable without a deploy. Needs a new `ErrorCode` in **both** `supabase/functions/_shared/response.ts` and `packages/contracts/src/errors.ts` |
| 8 | **Sentry / PostHog thresholds that declare an incident** | The Detect step | E.g. crash-free session rate floor, funnel-drop percentage. Without a number, "detect" means "someone noticed" |
| 9 | **Play Console account type — personal or organization** | The entire Android release calendar | A personal account created after 2023-11-13 requires 12 testers × 14 continuous days plus a production-access application before it can ever reach production |
| 10 | **Whether to enable OpenNext skew protection** (`run_worker_first: true` + `deploymentId` + CF API token env) | Whether percentage-based web rollouts are safe at all | A rollback concern only indirectly — it changes what "roll back" means when two versions can coexist. Decide in [ROLLOUTS.md](ROLLOUTS.md) |

---

## Related

- [ROLLOUTS.md](ROLLOUTS.md) — the upstream mitigations this document exists because of
- [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) — three channels, one codebase, and the version-skew contract
- [VERSIONING.md](VERSIONING.md) — the identifiers every step here depends on
- [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) — accounts, signing, console setup; the human-gated items
- [../OBSERVABILITY.md](../OBSERVABILITY.md) — how `client_platform`, `release` and `dist` get stamped, and the queries triage runs
- [../03-blocking-fixes.md](../03-blocking-fixes.md) — live defects referenced above (A1, A2, A5, A6, C1, C5)
- [../02-current-state.md](../02-current-state.md) — the audit these facts come from
- [../../DEPLOYMENT.md](../../DEPLOYMENT.md) — **stale**; its rollback section is superseded by this file
