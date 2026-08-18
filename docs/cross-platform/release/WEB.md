# Web Release Procedure

**Channel:** `web` — Next.js on Cloudflare Workers at `play10q.com`.
**Status:** the only release channel that exists today. iOS and Android do not exist yet ([01-architecture-decision.md](../01-architecture-decision.md)).

This document has two jobs. The first half describes **what actually happens today**, precisely enough that you can trace a commit to a served response. The second half describes **what must be added** before this channel is safe to operate alongside store binaries that can lag it by weeks.

> **The rule that governs everything here:** one codebase does not mean one deployment channel. Web ships continuously; iOS and Android ship on Apple's and Google's clocks. Therefore **no web deploy may assume the backend it talks to is only talking to web.** See [Ordering rule](#84-the-ordering-rule-non-negotiable).

---

## 1. What happens today

### 1.1 The whole pipeline, in order

```
git push origin main
  └─ GitHub Actions: .github/workflows/ci.yml
     ├─ job: ci            (runs on push AND pull_request)
     │   ├─ actions/checkout@v4
     │   ├─ actions/setup-node@v4   node 22, npm cache
     │   ├─ npm ci
     │   ├─ npm run lint          → eslint, all workspaces
     │   ├─ npm run typecheck     → tsc --noEmit, all workspaces
     │   ├─ npm test              → vitest, all workspaces (108 tests)
     │   ├─ npm run build         → next build in apps/web        ← ci.yml:36-44
     │   ├─ npx playwright install --with-deps chromium
     │   └─ npm run test:e2e      → 4 tests, Desktop Chrome only  ← ci.yml:49-54
     │
     └─ job: deploy        needs: ci
         if: github.event_name == 'push' && github.ref == 'refs/heads/main'   ← ci.yml:59
         ├─ checkout, setup-node, npm ci   (a second, independent checkout)
         └─ npm run deploy  (cwd apps/web)                        ← ci.yml:75-88
             = opennextjs-cloudflare build && opennextjs-cloudflare deploy
                ├─ next build
                ├─ OpenNext transform → apps/web/.open-next/
                │     worker.js + assets/
                └─ wrangler deploy (implicit)
                      creates a new Worker version AND routes 100% of
                      traffic to it, in one step
```

There is **one** workflow file. There are no other jobs, no manual triggers, no environments, no approvals.

### 1.2 The Worker

`apps/web/wrangler.jsonc` in full:

| Key | Value | Consequence |
|---|---|---|
| `name` | `10q-web` | Worker script name. Used by `wrangler` commands and version-override headers — see the [caveat in §4.3](#43-verify). |
| `main` | `.open-next/worker.js` | Built artifact; `apps/web/.gitignore:38` ignores `.open-next/`, so it exists only inside a build. |
| `compatibility_date` | `2026-02-23` | |
| `compatibility_flags` | `["nodejs_compat"]` | |
| `assets.directory` | `.open-next/assets` | Includes the whole `/_next/static/**` tree. |
| `assets.binding` | `ASSETS` | **The only binding.** No KV, D1, R2, Durable Objects, Queues, secrets or vars. |
| `workers_dev` | `true` | The Worker is also live at `10q-web.<subdomain>.workers.dev`, and version preview URLs are enabled. |
| `routes` | `play10q.com/*`, `www.play10q.com/*` (zone `12a66884a8c9c819e255004726c89a4d`) | |

**Not present:** any `[env.*]` block, `vars`, `version_metadata`, `assets.run_worker_first`, `assets.not_found_handling`, `preview_urls`.

Two consequences of that binding list matter later:

- **Rollback is cheap.** Cloudflare blocks a rollback when bindings were added/removed/modified or Durable Object class lifecycle changed between versions. With one static `ASSETS` binding and no stateful resources, neither blocker can apply. See [§7](#7-rollback).
- **Static assets are part of the version snapshot.** A Worker version bundles code *and* assets. Rolling back therefore restores a self-consistent code + asset pair — but it also means a traffic split serves two different asset manifests. See [§6.2](#62-the-caveat-that-decides-it-version-skew-on-content-hashed-chunks).

### 1.3 What the runtime does per request

`apps/web/src/middleware.ts` runs on every non-asset request:

- `:30` — `await supabase.auth.getUser()`, which refreshes the Supabase session and writes auth cookies onto the response.
- `:34` — `response.headers.set('Cache-Control', 'no-store')`.
- `:39-43` — matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and common image extensions.

`no-store` on HTML is load-bearing for this channel: it is why a rollback takes effect on the next navigation rather than whenever a browser cache expires. **Do not remove it** without re-reading [§7](#7-rollback).

Because `assets.run_worker_first` is unset, requests that match a file in `.open-next/assets` are served directly by Cloudflare and **never enter the Worker**. The middleware never sees a chunk request.

### 1.4 Where the game actually lives

The Worker serves HTML, RSC payloads, static assets, and the session-refresh middleware. That is all. Every authoritative operation — the 12-second question timer, the attempt state machine, scoring, streaks, leaderboards — is a Supabase Edge Function under `supabase/functions/` (22 of them), reached over plain `fetch` from the browser.

**A web deploy cannot break scoring, and a web rollback cannot fix it.** This asymmetry is the single most important input to the rollout strategy in [§6](#6-rollout-strategy) and to the ordering rule in [§8.4](#84-the-ordering-rule-non-negotiable).

---

## 2. Gaps — web channel specifically

Ordered by how much damage the gap does the first time it bites.

| # | Gap | Evidence | What it costs you |
|---|---|---|---|
| W1 | **CI verifies a different artifact than production ships** | `ci.yml:38-44` (build env) vs `ci.yml:78-88` (deploy env). `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` are given **only** to `deploy`. `NEXT_PUBLIC_*` is inlined at build time. | The bundle that passed lint/typecheck/tests/E2E is not the bundle that ships. Any failure inside the PostHog init path (`src/lib/posthog.ts:17-20` — reached only when `NEXT_PUBLIC_POSTHOG_KEY` is set, `:10-15`) is **structurally invisible to CI**. |
| W2 | **No version stamping anywhere** | Zero git tags in repo history. No CHANGELOG, no release workflow, no changesets. All three `package.json` files are pinned at `0.1.0`. Sentry sets `environment: process.env.NODE_ENV` and no `release` at all (`instrumentation-client.ts:6`, `sentry.server.config.ts:6`, `sentry.edge.config.ts:6`). PostHog registers no super properties. | You cannot answer "which build is this user on?" from a Sentry issue or a PostHog event. With store binaries in the field this stops being an inconvenience and becomes the primary diagnostic dead-end. |
| W3 | **No staging or preview environment** | No `[env.*]` in `wrangler.jsonc`. One Supabase project. One PostHog key. Sentry environment is always `production`. | Nothing can be exercised end-to-end before real users see it. Local `npm run dev` writes to the production Supabase project and the production PostHog project. |
| W4 | **No post-deploy verification** | `ci.yml` ends at `npm run deploy`. Nothing runs afterward. | A deploy is "successful" when `wrangler` exits 0. A white-screen production is a green pipeline. |
| W5 | **No rollback runbook** | Not documented anywhere in the repo. `docs/DEPLOYMENT.md` is stale — it documents Vercel, `daily_results`, and 17 of the 22 Edge Functions. | Under incident pressure, someone reaches for `git revert` + full rebuild (minutes) instead of `wrangler rollback` (seconds). |
| W6 | **Deploy is build-and-serve in one atomic step** | `apps/web/package.json:12` — `"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"`. `deploy` creates a version *and* routes 100% to it. `opennextjs-cloudflare upload` (create version only) is not scripted. | There is no moment where a production-infrastructure artifact exists but serves no users. That moment is the cheapest safety mechanism available on this platform, and it is currently skipped. |
| W7 | **The E2E suite cannot be pointed at production without a config edit** | `apps/web/playwright.config.ts:21` honors `PLAYWRIGHT_TEST_BASE_URL`, **but** `:35-40` unconditionally starts `npm run dev` and waits on the hardcoded `http://localhost:3000`. | The obvious "just set the base URL" smoke-test shortcut silently boots a dev server. Fix required before [§4](#4-post-deploy-smoke-test) can be automated. |
| W8 | **Both jobs upload source maps to the same Sentry project with no release identifier** | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are set on `ci.yml:42-44` *and* `:82-84`. `next.config.ts:36-43` passes them to `withSentryConfig`. No `release` is configured. | Two builds per push publish artifacts into one undifferentiated bucket. Symbolication is a coin flip on which upload won. Fixing W2 fixes this as a side effect. |

None of these are hard to close. W1, W2 and W4 are the ones that must close before a store binary exists, because a lagging binary makes "which build, which environment, did the deploy work" the first three questions of every incident.

Tracked against the phased plan in [../05-migration-plan.md](../05-migration-plan.md); identifier mechanics in [../OBSERVABILITY.md](../OBSERVABILITY.md); version source of truth in [VERSIONING.md](VERSIONING.md).

---

## 3. Prerequisites

### 3.0 The scripts that will eventually do this for you

`scripts/release/` defines the intended automation contract. **Every script there is a stub that exits non-zero today** — see `scripts/release/README.md`. Three are relevant to this channel:

| Script | Contract | Replaces |
|---|---|---|
| `scripts/release/preflight` | Verify repo, gates and credentials are ready | [§4.1](#41-prepare) |
| `scripts/release/web` | Build, deploy and smoke-test the Worker; report the version id | [§4.2](#42-deploy) + [§5](#5-post-deploy-smoke-test) |
| `scripts/release/verify` | Report what version is live on each channel | [§4.4](#44-observe) |

Until they are implemented (Phase 9 of [../05-migration-plan.md](../05-migration-plan.md)), **follow the procedure below by hand and say explicitly that you did so.** Do not report that a script passed when it exited 1.

### 3.1 Tooling

| Tool | Where it comes from | Notes |
|---|---|---|
| Node 22 | matches `ci.yml:20` / `:69` | Node 20 will build but is not what CI uses. |
| `wrangler` | `apps/web` devDependency `^4.71.0` | Run as `npx wrangler …` **from `apps/web`** so `wrangler.jsonc` is picked up automatically. Gradual deployments need ≥ 3.40.0; `--preview-alias` needs ≥ 3.91.0. Both satisfied. |
| `opennextjs-cloudflare` | `apps/web` devDependency `@opennextjs/cloudflare ^1.17.1` | |
| `supabase` CLI | **not a repo dependency** — install separately | Needed only for the backend half, [§8](#8-the-supabase-half). |

### 3.2 Credentials

Everything below is a GitHub Actions repository secret today. **A local deploy needs them in your shell instead.**

| Secret | Used by | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy job (`ci.yml:87`) | Needs Workers Scripts:Edit on the account. |
| `CLOUDFLARE_ACCOUNT_ID` | deploy job (`ci.yml:88`) | |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | both jobs | Inlined into the bundle. |
| `NEXT_PUBLIC_SENTRY_DSN` | both jobs | |
| `SENTRY_AUTH_TOKEN` | both jobs | Source map upload. `SENTRY_ORG=10q-1z`, `SENTRY_PROJECT=javascript-nextjs` are literals in `ci.yml`, not secrets. |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | **deploy job only** — this is W1 | |

`apps/web/.env.example` lists the client-side set. `apps/web/.env.local` exists on developer machines and is gitignored.

> **HUMAN HANDOFF.** An agent cannot mint a Cloudflare API token or read repository secrets. If a local deploy or rollback is needed and `CLOUDFLARE_API_TOKEN` is not already exported, stop and ask Riley for a scoped token. Do not attempt to create one.

---

## 4. Prepare → Deploy → Verify → Observe

### 4.1 Prepare

Run everything CI runs, locally, before pushing. This is not redundant — it is the only place where you can still cheaply change your mind.

```bash
cd /Users/rocky/Code/10q-app

npm ci
npm run lint          # eslint across workspaces
npm run typecheck     # tsc --noEmit across workspaces
npm test              # vitest: apps/web 62 + packages/contracts 46

# Build the exact artifact production will ship — including PostHog,
# which CI's build step omits (W1).
cd apps/web
NEXT_PUBLIC_POSTHOG_KEY=<prod key> \
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
npx opennextjs-cloudflare build

# Run that artifact in workerd locally (not `next dev` — a different runtime)
npm run preview       # = opennextjs-cloudflare build && opennextjs-cloudflare preview
```

`npm run preview` is the highest-value pre-deploy check available today, because it is the only step that exercises the OpenNext-transformed worker rather than the Next dev server. The Playwright suite does **not** do this: `playwright.config.ts:36` runs `npm run dev`.

**Know what your test suite does not cover before you rely on it.** 108 unit tests, all against pure lib modules in a `node` environment (`apps/web/vitest.config.ts:5` — no jsdom, no `@testing-library`, zero component tests). Four E2E tests across three files, on Desktop Chrome only; `apps/web/e2e/auth.spec.ts` is a verbatim duplicate of the home-title test in `home.spec.ts`, so there is **no auth coverage at all**. `supabase/tests` never runs — it is not in the root `workspaces` array (`package.json:5-8`). A green pipeline means "it compiles and the home page has a title."

### 4.2 Deploy

#### 4.2.1 Today's path (automatic)

```bash
git push origin main
```

That is the entire procedure. `ci` gates, then `deploy` builds and routes 100% of traffic to the new version. Watch it:

```bash
gh run watch                      # or: gh run list --workflow=ci.yml --limit 5
```

If `ci` fails, `deploy` never runs (`needs: ci`). If `deploy` fails partway, the previous version keeps serving — `wrangler deploy` does not tear down the old version before the new one is accepted.

#### 4.2.2 The recommended path (upload → verify → promote)

This is the target state for W6 and it can be adopted today without changing any Cloudflare configuration. Add to `apps/web/package.json`:

```jsonc
"upload":  "opennextjs-cloudflare build && opennextjs-cloudflare upload",
"promote": "wrangler versions deploy"
```

Then the procedure becomes:

```bash
cd apps/web

# 1. Build and upload. Creates a version. Serves nobody.
npm run upload
#    → prints "Worker Version ID: <uuid>". Capture it.

# 2. Verify the version on production infrastructure — see §4.3.

# 3. Promote to 100%.
npx wrangler versions deploy <NEW_VERSION_ID>@100%
```

`opennextjs-cloudflare deploy` and `upload` differ in exactly one thing: `deploy` starts serving as soon as the upload lands; `upload` creates the version and stops. Keep `deploy` in `package.json` as the emergency path.

**Deploy window.** The daily quiz publishes at 11:30 UTC (`supabase/migrations/20260402000000_publish_scheduled_quiz_function.sql:98-100`, cron `30 11 * * *`). Traffic is a daily cohort, not a steady stream: it spikes after publish and again in US evening hours. Deploy in the trough — roughly 08:00–11:00 UTC, before the day's quiz goes live. Validate that window against real PostHog session data before treating it as fact; it is inferred from the publish schedule, not measured.

### 4.3 Verify

Run the smoke test in [§5](#5-post-deploy-smoke-test). Do not skip it because the pipeline was green — W4 exists precisely because green means very little here.

With the upload-then-promote flow, verification happens **before** promotion, against a version that serves no production traffic. Two ways in:

**A. Version preview URL (recommended).** `workers_dev: true` means every uploaded version gets a URL:

```
https://<version-prefix>-10q-web.<your-subdomain>.workers.dev
```

For a **stable** hostname across versions — which is what lets you register it once in Supabase Auth redirect URLs and therefore actually smoke-test sign-in:

```bash
npx wrangler versions upload --preview-alias staging
# → https://staging-10q-web.<your-subdomain>.workers.dev
```

Caveats, all real:
- `wrangler tail` and Workers Logs do **not** work for preview URLs.
- The preview URL hits the **production** Supabase project. Any write is a real write.
- Sign-in on the preview hostname requires that hostname in the Supabase Auth allowed redirect URLs. **DECISION REQUIRED:** whether to register a permanent `staging-10q-web.*.workers.dev` alias in Supabase Auth. Doing so is the cheapest thing resembling a staging environment available before W3 is properly closed; it also means an extra origin can complete OAuth into production accounts. Decide deliberately.

**B. Deploy at 0% and pin with a header.**

```bash
npx wrangler versions deploy <CURRENT_ID>@100% <NEW_ID>@0%
curl -sI https://play10q.com/ \
  -H 'Cloudflare-Workers-Version-Overrides: 10q-web="<NEW_ID>"'
```

> ⚠️ **Verify this works before depending on it.** `Cloudflare-Workers-Version-Overrides` is a Structured Header *Dictionary*, whose keys must begin with a lowercase letter. This Worker is named `10q-web` — it begins with a digit. The header may be rejected as malformed. Test it once with `curl -v` and confirm you get the new version; if you do not, use path A. Renaming the Worker to fix this would create a *new* Worker and require re-pointing the `play10q.com` routes — not worth it.

### 4.4 Observe

After promotion, watch for **15 minutes minimum**, or through the next traffic spike if you deployed close to 11:30 UTC.

| Signal | Where | What "bad" looks like |
|---|---|---|
| Errors | Sentry project `10q-1z / javascript-nextjs` | Any new issue fingerprint, or a step change in an existing one. Note: `tracesSampleRate: 0` in all three inits — you get errors, not performance. |
| Funnel | PostHog | `quiz_start` → `answer_submitted` → `quiz_finalized` completion rate against yesterday's same hour. |
| Worker errors | `npx wrangler tail` from `apps/web` | Live tail of the production Worker. Does not work against preview URLs. |
| Deployment state | `npx wrangler deployments status` | Confirms which version(s) are serving and at what percentages. |

**You currently cannot attribute any of this to a build.** Sentry has no `release`, PostHog has no super properties. Closing W2 is what makes this section mean something — see [../OBSERVABILITY.md](../OBSERVABILITY.md) for the five identifiers (`release_sha`, `client_platform`, `app_version`, `app_build`, `environment`) and [VERSIONING.md](VERSIONING.md) for where the version comes from.

For the web channel specifically, closing W2 means adding to the `deploy` job env in `ci.yml`:

```yaml
NEXT_PUBLIC_CLIENT_PLATFORM: web
NEXT_PUBLIC_RELEASE_SHA: ${{ github.sha }}
NEXT_PUBLIC_APP_BUILD: ${{ github.run_number }}
NEXT_PUBLIC_ENVIRONMENT: production
NEXT_PUBLIC_APP_VERSION: # from the version source of truth — see VERSIONING.md
```

…and the same values to the **`ci` job's build step**, along with the PostHog pair, so W1 closes at the same time.

Two things that are easy to conflate:

- **`CF_VERSION_METADATA` is not a client identifier.** Adding `"version_metadata": { "binding": "CF_VERSION_METADATA" }` to `wrangler.jsonc` exposes `env.CF_VERSION_METADATA.{id,tag,timestamp}` **inside the Worker only**. The browser bundle cannot read it. Add it — it is how you attribute server-side logs to a version — but it does not substitute for the build-time `NEXT_PUBLIC_*` stamps.
- **Therefore record the mapping.** The Cloudflare version ID and the git SHA are different identifiers for the same release. Echo `Worker Version ID` into `$GITHUB_STEP_SUMMARY` in the deploy job so that six weeks later, "Sentry says `release_sha=af86e61`" translates to a version ID you can roll back to.

---

## 5. Post-deploy smoke test

### 5.1 The minimal set

Five checks. They are chosen to touch every layer exactly once: asset serving, client hydration, the Supabase Edge Function boundary, the timer/scoring path, and auth.

| # | Check | Passes when | Layer proved | Writes to prod data? |
|---|---|---|---|---|
| **S1** | **Home loads** — `GET https://play10q.com/` | 200, `<title>` matches `/10Q/i`, page renders past hydration, **zero 404s in the network log** | Worker + asset manifest coherence | No |
| **S2** | **Quiz starts** — from `/`, follow through to `/play`, wait for the 3-2-1 countdown, land on `/play/q/1` with a question and a running timer | Q1 renders with four choices and a counting-down timer | Anonymous auth → `start-attempt` → `start-question-timer` | **Yes** |
| **S3** | **An answer submits** — tap a choice on Q1 | Answer locks in and the app advances to `/play/q/2` without a full page reload | `submit-answer`; client↔server timer agreement | **Yes** |
| **S4** | **Results render** — complete all 10 (any answers), reach `/play/finalize` → `/results` | Score animates, per-question breakdown lists 10 rows | `finalize-attempt` + `get-attempt-results` | **Yes** |
| **S5** | **Sign-in works** — from `/`, sign in with Google *and* with Apple, land back on the app signed in | Session persists across a reload | OAuth redirect → `/auth/callback` → session cookie via `middleware.ts:30` | **Yes** |

Add **S6 — leaderboard renders** (`GET /leaderboard`, heading visible) whenever the deploy touched leaderboard or league code. It is read-only and free.

**Skip nothing on the basis that "the change was small."** S1 is the one that catches the failure mode this platform actually produces: a coherent-looking HTML document whose JS chunks 404.

### 5.2 The honest cost of S2–S5

**A full smoke run writes real production data and lands on the public leaderboard.**

The chain is not hypothetical. `supabase/functions/start-attempt/index.ts:62-74` auto-creates a `players` row for any user who does not have one, with handle `Player<first-8-chars-of-uuid>`. `get-global-leaderboard/index.ts:150-174` reads `handle_display` straight through. So a smoke run finalizing 10 answers produces a visible `PlayerXXXXXXXX` entry in the day's global leaderboard with whatever score it scored.

There is also a one-attempt-per-day constraint, so a smoke account cannot repeat within a UTC day.

Handle it deliberately. Three options, in order of preference:

1. **Split the tiers.** Run S1 + S6 on every deploy (free, automatable, catches the common failure). Run S2–S5 only on deploys that touch the quiz flow, auth, or `GameProvider`.
2. **Clean up after.** Delete the smoke player's rows via the `10q-db` admin tool or the Supabase SQL editor. **Do not use the `delete-attempt` Edge Function for this** — it is [03-blocking-fixes.md](../03-blocking-fixes.md) A1, a critical leaderboard-bypass vulnerability slated for deletion. Do not build a procedure that depends on it surviving.
3. **Close W3 properly.** A second Supabase project is the actual fix, and it is the only one that makes S2–S5 runnable on every deploy without consequence. Until then, options 1 and 2 are the compromise.

**Timing constraint:** S2–S4 require a published quiz for the current UTC day. Before 11:30 UTC, `/play` legitimately shows the "no quiz available" state (`trackQuizUnavailable` in `apps/web/src/app/play/page.tsx`) and S2 cannot pass. That is not a regression. Either smoke after 11:30 UTC or accept that S2–S4 are untestable in the recommended deploy window — which is itself a good argument for closing W3.

### 5.3 How to run it

**Manual (works today, ~4 minutes).** Walk S1–S5 in a real browser against `https://play10q.com` (or the `--preview-alias` hostname, pre-promotion). Keep DevTools Network open for the whole run — S1's "zero 404s" clause is the point of the exercise, and no automated check currently covers it.

**S5 stays manual regardless.** Google blocks OAuth in automation-controlled browsers, and Sign in with Apple is worse. Do not sink time into automating it. It is also the check most likely to break silently, because the redirect allowlist lives in Supabase Auth settings — outside the repo and outside CI.

**Automated (S1–S4, S6).** Playwright is already installed and is the right tool. Two changes required first:

1. **Make `webServer` conditional** — `playwright.config.ts:35-40` currently boots `npm run dev` and waits on hardcoded `http://localhost:3000` regardless of `PLAYWRIGHT_TEST_BASE_URL` (this is W7):

   ```ts
   webServer: process.env.PLAYWRIGHT_TEST_BASE_URL ? undefined : {
     command: 'npm run dev',
     url: 'http://localhost:3000',
     reuseExistingServer: !process.env.CI,
     timeout: 120 * 1000,
   },
   ```

2. **Put the smoke specs in their own directory** (`apps/web/e2e-smoke/`) with a separate config, so `npm run test:e2e` in the `ci` job never accidentally runs write-path tests against production.

Then:

```bash
cd apps/web
PLAYWRIGHT_TEST_BASE_URL=https://play10q.com npx playwright test --config=playwright.smoke.config.ts
```

Wire this as a step in the `deploy` job **after** the promote step, and have it fail the job. A failing smoke test is the trigger for [§7](#7-rollback).

---

## 6. Rollout strategy

### 6.1 What Cloudflare offers

`wrangler deploy` (what `opennextjs-cloudflare deploy` calls) creates a version and sends 100% of traffic to it in one step. Gradual deployments decouple those:

```bash
npx wrangler versions upload                                   # version, 0 traffic
npx wrangler versions deploy <OLD>@90% <NEW>@10%               # split
npx wrangler versions deploy <NEW>@100%                        # finish
```

Mechanics worth knowing before you consider it:

- Traffic splitting is **per-request and random**. There is no stickiness by default.
- A single deployment can serve **at most two versions**. No three-way splits.
- You can only split with, and only roll back to, the **last 100 versions**.
- **Version affinity** removes the randomness: set the request header `Cloudflare-Workers-Version-Key` and Cloudflare hashes it to a deterministic version for the life of the rollout. On a zone you control it is a Transform Rule — `play10q.com` qualifies (`wrangler.jsonc` zone `12a66884a8c9c819e255004726c89a4d`), Free plan allows 10 Transform Rules, and the documented rule uses no regex so it fits. It is **not** available on `*.workers.dev` hostnames.

### 6.2 The caveat that decides it: version skew on content-hashed chunks

A Worker version snapshot includes its static assets. Cloudflare documents the exact failure this produces:

> A request for `/` lands on Version A and returns HTML referencing `index-a1b2c3d4.js`. The browser's independent follow-up request for that file is routed separately and may land on Version B, which only has `index-m3n4o5p6.js`. Result: 404.

That is `/_next/static/chunks/*` verbatim. In this repo the exposure is total: the Worker and the entire `.open-next/assets` tree are one version (`wrangler.jsonc` `main` + `assets.directory`), and `assets.run_worker_first` is unset, so chunk requests never enter the Worker where you might otherwise intervene.

Two documented fixes exist. Both are real work:

- **Version affinity** — a Transform Rule keyed on a stable per-user value (a cookie, or `ip.src` with NAT caveats).
- **OpenNext skew protection** — `skewProtection` in `open-next.config.ts`, `deploymentId: getDeploymentId()` in `next.config.ts`, `assets.run_worker_first: true` in `wrangler.jsonc`, plus `CF_WORKER_NAME` / `CF_PREVIEW_DOMAIN` / `CF_WORKERS_SCRIPTS_API_TOKEN` / `CF_ACCOUNT_ID`. Experimental. `run_worker_first: true` means **every asset request invokes the Worker** — a latency and billing change.

### 6.3 Recommendation for 10Q

> **Do not use percentage-based gradual deployment for the 10Q Worker. Use fast-100% with fast rollback — but upgrade the mechanics to upload → verify → promote ([§4.2.2](#422-the-recommended-path-upload--verify--promote)).**

That gets the genuine benefit of versions — validating a real artifact on real production infrastructure before any user touches it — without introducing a traffic split. Five reasons, all specific to this repo:

**1. A Worker split cannot canary the thing that can actually break the game.** The 12-second server-authoritative timer, the attempt state machine, and scoring are all Supabase Edge Functions, deployed on a completely separate pipeline that a Cloudflare percentage does not touch ([§8](#8-the-supabase-half)). A 5/95 Worker split canaries asset serving, SSR/RSC output, and session-refresh middleware — the parts least likely to silently corrupt game state.

**2. The split creates the incident class it is meant to prevent.** Without affinity or skew protection, every chunk request is a coin flip against a version that may not have that hash. For a game with a hard 12-second per-question timer, a mid-quiz chunk 404 or failed hydration is not a retry — **it burns the player's one attempt for the day**, and there is no legitimate way to give it back.

**3. Concurrent versions can fight over auth cookies.** `middleware.ts:11-34` refreshes the Supabase session and writes cookies on every non-asset request. Two versions alternately serving the same browser — especially across a `@supabase/ssr` upgrade, a cookie-name change, or a cookie-chunking change — can each rewrite the other's cookies, producing session churn or spurious sign-outs. That risk scales with how long two versions coexist, which is exactly what a slow rollout maximizes.

**4. The canary signal is weak at this traffic shape.** A daily trivia game concentrates traffic in a spike. Off-peak, 5% is too few requests to be statistically meaningful before you would have promoted anyway; at peak, that 5% is drawn from the most engaged players. Gradual rollout pays for itself under steady high volume. That is not this traffic yet.

**5. Rollback here is genuinely cheap** — see [§7](#7-rollback). Every precondition is favorable. When reverting takes seconds and cannot be blocked, "go to 100%, watch, revert" is the low-variance strategy.

**Guardrails that make fast-100% safe.** These are the price of the recommendation, not optional extras:

1. Switch `apps/web/package.json` to `upload` + an explicit promote step; keep `deploy` for emergencies only.
2. Add the `version_metadata` binding and stamp identifiers into Sentry and PostHog (W2), so "which version broke" is answerable in seconds.
3. Deploy outside the daily play window ([§4.2.2](#422-the-recommended-path-upload--verify--promote)).
4. Keep the one-line rollback in this file and **rehearse it** on a no-op deploy before you need it under pressure.
5. Keep `Cache-Control: no-store` on HTML (`middleware.ts:34`).

### 6.4 What would change this answer

Revisit when any of these becomes true:

| Trigger | Why it flips the decision |
|---|---|
| OpenNext `skewProtection` is enabled and proven | Removes the asset-404 failure mode; splits become safe. Costs a Worker invocation per asset request and carries experimental-feature risk. |
| A version-affinity Transform Rule exists on `play10q.com`, keyed on a stable cookie | Same effect, simpler, fits on the Free plan. This is the cheaper of the two. |
| Game logic migrates from Edge Functions into the Worker | Next route handlers or server actions becoming authoritative for timing or scoring makes a split a genuine canary — **and makes affinity mandatory, not optional.** |
| Traffic grows enough that a bad 100% deploy has real cost | A 5% slice becomes statistically informative. |
| Deploys start landing inside the play window via automated CD | The blast radius of a bad deploy stops being bounded by scheduling. |
| **Durable Objects are added to the Worker** | Reverses direction: gradual deployments behave differently (one version per object) and preview URLs stop being generated. This whole plan needs re-deriving. |

---

## 7. Rollback

### 7.1 When

Roll back when any smoke check ([§5.1](#51-the-minimal-set)) fails, when Sentry shows a new error fingerprint at meaningful volume, or when the `quiz_start → quiz_finalized` funnel drops against the same hour yesterday.

**Roll back first, diagnose second.** A forward fix requires a full CI run plus an OpenNext build. A rollback is one command against an artifact that already worked.

### 7.2 How — CLI

From `apps/web` (so `wrangler.jsonc` is picked up):

```bash
# 1. See what is serving now.
npx wrangler deployments status

# 2. List recent versions, newest first.
npx wrangler versions list

# 3a. Roll back to the version immediately preceding the active one.
npx wrangler rollback --message "Reverting <sha>: <one-line reason>"

# 3b. Or roll back to a specific known-good version.
npx wrangler rollback <VERSION_ID> --message "Reverting to last known good"

# 3c. Equivalent, and the form to use if you are currently in a gradual
#     deployment — it collapses the split back to a single version.
npx wrangler versions deploy <GOOD_VERSION_ID>@100%
```

`wrangler rollback` prompts for confirmation and takes effect within seconds of the deployment being accepted.

### 7.3 How — dashboard

When the CLI is unavailable (no local token, laptop is the problem):

**Cloudflare dashboard → Workers & Pages → `10q-web` → Deployments tab → find the target version in the list → three-dot menu at the right of its row → Rollback → confirm.**

The same page shows the currently active deployment and its version split, if any.

### 7.4 Verify the rollback took

Do not trust the exit code. Three checks:

```bash
# 1. Cloudflare agrees.
npx wrangler deployments status
#    → active deployment should name the target version at 100%
```

```bash
# 2. The edge is serving it. Once W2 is closed and the build stamps a
#    version, this is a one-liner:
curl -s https://play10q.com/ | grep -o 'data-dpl-id="[^"]*"'
#    Until then, diff a content-hashed chunk filename against the good build:
curl -s https://play10q.com/ | grep -o '/_next/static/chunks/[^"]*\.js' | head -3
```

3. **Re-run the smoke test** ([§5.1](#51-the-minimal-set)). This is the only check that proves the *product* recovered rather than the deployment record changing. Because `middleware.ts:34` sets `Cache-Control: no-store`, a hard refresh is not required — the next navigation gets the rolled-back HTML.

### 7.5 What rollback does **not** undo

| Not reverted | Why it matters here |
|---|---|
| **Supabase migrations** | Entirely separate pipeline. A Worker rollback does not touch a schema change. See [§8.4](#84-the-ordering-rule-non-negotiable). |
| **Edge Function deployments** | Same. `supabase functions deploy` is not in CI at all. |
| **Data written by the bad version** | Attempts started, answers submitted, `daily_scores` rows. If a bad deploy corrupted attempt state, rolling back the Worker stops the bleeding; it does not repair rows. |
| **Attached storage resources** | Cloudflare explicitly does not revert KV/D1/R2/DO contents. Not applicable today — `ASSETS` is the only binding — but it becomes applicable the moment one is added. |

**When rollback is blocked.** Cloudflare refuses a rollback if bindings were deleted or modified, or if a Durable Object class lifecycle changed, between the target and active versions. Neither can apply today. If you ever get that error, it means the Worker gained state and this runbook is out of date.

---

## 8. The Supabase half

### 8.1 Current state — deployed by hand, honestly

**Nothing in `supabase/` is in CI.** `ci.yml` contains one workflow with two jobs; neither mentions Supabase. The backend is deployed from a developer laptop:

- **22 Edge Functions** under `supabase/functions/` (23 directories, of which `_shared/` is a library), each registered in `supabase/config.toml:48-91`.
- **14 migrations** under `supabase/migrations/`.

There is no linked-project record in the repo (`supabase/.temp/` is absent), so the project link is per-machine state.

### 8.2 The manual procedure

```bash
cd /Users/rocky/Code/10q-app

# One-time per machine. Requires a Supabase access token (interactive login)
# and the project ref.
supabase login
supabase link --project-ref <PROJECT_REF>

# Migrations
supabase migration list      # compare local files against what the remote has applied
supabase db push             # applies pending migrations to the LINKED project

# Edge Functions
supabase functions deploy <name>     # one function
supabase functions deploy            # all functions in supabase/functions/
```

> **HUMAN HANDOFF.** `supabase login` is an interactive browser OAuth flow and `<PROJECT_REF>` identifies the production database. An agent must not guess either. Ask Riley for the project ref, and have him complete the login. **DECISION REQUIRED:** the project ref is not recorded anywhere in the repo — decide whether it belongs in a committed `supabase/config.toml` `project_id` field or stays out of version control.

**Verify after deploying:**

```bash
supabase migration list                       # remote column should now match local
supabase functions list                       # deployment timestamps
curl -s -X POST https://<PROJECT_REF>.supabase.co/functions/v1/get-current-quiz \
  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

Then run smoke checks **S2–S4** from [§5.1](#51-the-minimal-set). Those are the checks that exercise the Edge Function boundary; S1 and S6 will pass happily against a broken backend.

### 8.3 Why this is a hazard now

It was survivable when web was the only client, because a `git push` shipped the client and a `supabase functions deploy` shipped the backend within minutes of each other, from the same person, in the same sitting.

**Store binaries destroy that property.** An iOS build reviewed and shipped in week 1 is still installed and calling these functions in week 9. So:

- A hand-deployed Edge Function change is now a change to a contract that **three independently-versioned clients** depend on, one of which cannot be updated on your schedule.
- Nothing records *what* was deployed *when*. No tags, no deployment log, no CI run to point at. After an incident there is no artifact answering "was the backend changed that day?"
- `supabase db push` applies whatever is pending against production, with no dry run in the loop and no review gate. `docs/DEPLOYMENT.md`'s rollback advice for this — `supabase db reset` — **destroys the database** and must not be run against production. Treat that document as historical.
- The RLS test suite that would catch a policy regression **never runs** — `supabase/tests` is absent from the root `workspaces` array (`package.json:5-8`), is stale against the current schema, and hardcodes the production URL and anon key as defaults ([03-blocking-fixes.md](../03-blocking-fixes.md) A5). Do not run it as-is.

Getting Supabase into CI is [../05-migration-plan.md](../05-migration-plan.md) work, not this document's. What this document owns is the rule that keeps the current manual process from breaking clients.

### 8.4 The ordering rule (non-negotiable)

> **Backward-compatible backend changes deploy BEFORE the clients that need them. Never the reverse.**

Stated as a procedure:

1. **Make the backend change additive.** New optional request fields. New response fields alongside the old ones. New Edge Functions rather than changed signatures. A function must keep serving a client that has never heard of the change.
2. **Deploy the backend and verify it** against the *current* production clients — the ones already in the field. Nothing should change for them.
3. **Then deploy the clients** that use the new capability: web now, iOS and Android whenever their store timelines allow.
4. **Only remove the old path** once telemetry shows no client is still using it. With store binaries that is months, not days — and you can only measure it after W2 is closed, because `client_platform` + `app_version` on every event is what makes "is anyone still on the old path?" answerable at all.

**Why the reverse order is forbidden:** shipping a client that requires a backend change that has not landed breaks the client immediately. On web that is a 30-second rollback. **On iOS it is a multi-day App Review cycle during which the app is broken for everyone who already updated.** The asymmetry is the whole argument.

**Concrete web-channel consequence:** a breaking change to an Edge Function is never a web-only decision, even while web is the only channel. The moment an iOS binary exists, `apps/web/src/lib/api/edge-functions.ts` stops being *the* client contract and becomes *a* client contract. Write the change as if a nine-week-old binary is calling it, because one will be.

**Do not treat `packages/contracts/openapi.yaml` as the contract.** It is abandoned and wrong — it documents 5 of 22 functions, every path is incorrect, and the answer-submit field name is wrong. The real contract is `apps/web/src/lib/api/edge-functions.ts` plus the function implementations.

---

## 9. Checklist

Copy this into the PR or the deploy issue.

**Prepare**
- [ ] `npm run lint && npm run typecheck && npm test` green locally
- [ ] `npm run preview` in `apps/web` — the workerd artifact boots and the home page renders
- [ ] Any Supabase change is additive, deployed, and verified **first** ([§8.4](#84-the-ordering-rule-non-negotiable))
- [ ] Deploying inside the low-traffic window, or there is a stated reason not to

**Deploy**
- [ ] `ci` job green (lint, typecheck, 108 unit tests, build, 4 E2E)
- [ ] Version uploaded; `Worker Version ID` recorded ([§4.2.2](#422-the-recommended-path-upload--verify--promote))
- [ ] Verified on the preview URL before promotion ([§4.3](#43-verify))
- [ ] Promoted to 100%

**Verify**
- [ ] S1 home loads, **zero 404s in the network log**
- [ ] S2 quiz starts *(if the deploy touched play/auth, and after 11:30 UTC)*
- [ ] S3 an answer submits
- [ ] S4 results render
- [ ] S5 sign-in works — Google **and** Apple *(manual, always)*
- [ ] S6 leaderboard renders *(if touched)*
- [ ] Smoke-test data cleaned up, or consciously left ([§5.2](#52-the-honest-cost-of-s2s5))

**Observe (15 min, or through the next spike)**
- [ ] No new Sentry issue fingerprints
- [ ] PostHog funnel flat against yesterday's same hour
- [ ] `npx wrangler deployments status` shows the intended version at 100%

**If any of the above fails**
- [ ] Roll back ([§7.2](#72-how--cli)) before diagnosing
- [ ] Verify the rollback took ([§7.4](#74-verify-the-rollback-took))

---

## Related

| Document | What it covers |
|---|---|
| [RELEASE_ARCHITECTURE.md](RELEASE_ARCHITECTURE.md) | How the three channels relate; the version-skew contract |
| [VERSIONING.md](VERSIONING.md) | The version source of truth that closes W2 |
| [ROLLOUTS.md](ROLLOUTS.md) | Cross-channel rollout posture |
| [ROLLBACKS.md](ROLLBACKS.md) | Why [§7](#7-rollback) is easy here and impossible on the store channels |
| [IOS.md](IOS.md) · [ANDROID.md](ANDROID.md) | The two channels that do not exist yet, and whose latency the ordering rule protects |
| [FIRST_STORE_RELEASE.md](FIRST_STORE_RELEASE.md) | First submission to each store |
| [../OBSERVABILITY.md](../OBSERVABILITY.md) | The five identifiers, and how they reach PostHog and Sentry |
| [../01-architecture-decision.md](../01-architecture-decision.md) | Why Capacitor; why web stays on OpenNext + Workers |
| [../02-current-state.md](../02-current-state.md) | Audit evidence behind every claim in [§1](#1-what-happens-today) and [§2](#2-gaps--web-channel-specifically) |
| [../03-blocking-fixes.md](../03-blocking-fixes.md) | Security and correctness defects that gate any store submission |
| [../05-migration-plan.md](../05-migration-plan.md) | Where W1–W8 sit in the phased plan |

> `docs/DEPLOYMENT.md` at the repo root is **stale and misleading** — it documents Vercel hosting, a `daily_results` table that was renamed, and 17 of the 22 Edge Functions, and its "Rollback Database Migration" section recommends `supabase db reset`, which destroys data. This file supersedes it for the web channel. Delete or rewrite it.
