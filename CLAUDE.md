# 10Q

Daily trivia game. Next.js web client in `apps/web`, shared contracts in
`packages/contracts`, Supabase backend in `supabase/`.

Live at [play10q.com](https://play10q.com). Admin authoring lives in a **separate repo**, `10q-db`.

## Active cross-platform migration

10Q is currently undergoing a Web/iOS/Android architecture migration.

Before modifying code related to the client architecture, mobile platforms,
analytics, observability, testing, CI/CD, or releases, read and follow:

**[.agent/skills/cross-platform-migration/SKILL.md](.agent/skills/cross-platform-migration/SKILL.md)**

Start any resumed or compacted session with *"Use the cross-platform migration
skill and continue the migration."* The current checkpoint is
[docs/cross-platform/STATUS.md](docs/cross-platform/STATUS.md); the authoritative
plan is [docs/cross-platform/](docs/cross-platform/).

> ### ⚠️ Before writing any mobile code
>
> There are **live security defects** in
> [docs/cross-platform/03-blocking-fixes.md](docs/cross-platform/03-blocking-fixes.md)
> that are currently protected only by the effort of reading a minified bundle.
> Packaging the app as an IPA/APK makes them trivially discoverable. Section A
> must land before any external build exists.
>
> Most urgent: `delete-attempt` lets any signed-in user wipe their attempt and
> replay it with the answer key in hand, for a perfect 100 every day. The only
> thing stopping them today is a client-side `if (!isAdmin)`.

> This section is temporary. Remove it when the migration completion contract in
> the skill is satisfied and the skill is deleted.

## What the game is

A new quiz of **10 questions** drops globally at **11:30 UTC**; every player gets identical
questions in identical order. One attempt per player per day. Each question has a
**12-second** server-authoritative timer with a step-based speed bonus.

## Repo map

```
apps/web/              Next.js 16 App Router · React 19 · Tailwind 4 · framer-motion
  src/app/             routes + screens   (22 of 23 pages are "use client")
  src/components/      presentation only
  src/domains/         domain adapters (attempt, quiz, leaderboard, league, profile)
  src/lib/api/         Edge Function client — THE REAL API CONTRACT
packages/contracts/    scoring · handles · constants shared with the web app
supabase/
  functions/           31 dirs on disk — 27 are 10Q's, 4 belong to transfers
  migrations/          schema, RLS, triggers
  tests/               ~85 tests that DO NOT RUN — see below
tools/friday/          the `friday` dev CLI — see below
scripts/               one-off tooling + release machinery
docs/cross-platform/   the multi-platform program
```

**Deploys to Cloudflare Workers via OpenNext**, not Vercel — `apps/web/package.json` →
`deploy` → `opennextjs-cloudflare build && deploy`, driven by `.github/workflows/ci.yml`.
Any doc that says Vercel is wrong.

## Architecture rules — non-negotiable

1. **The client is hostile.** All scoring, timing and state transitions happen in Edge
   Functions under the service role. The client never computes a score and never sends
   timing data.
2. **Route handlers and components are thin.** Business logic goes in Edge Functions;
   domain adapters only reshape responses.
3. **Contracts and DB invariants first.** Update `packages/contracts/` and add the
   migration before implementing. Prefer SQL constraints over application checks.
4. **Migrations + RLS + tests ship together.**
5. **Version skew is permanent.** Once iOS/Android ship, clients update independently and
   store binaries stay installed for months. Edge Function changes must be additive and
   backward-compatible. Never remove or repurpose a field.

## Facts that surprise people

- **Anonymous-first.** Every visitor gets `signInAnonymously()` before any sign-in prompt.
  Signing in uses `linkIdentity`, which preserves the user id so scores, streaks and
  leagues survive the upgrade. Do not break this.
- **`packages/contracts/openapi.yaml` is abandoned and wrong.** It documents 5 of 22
  functions, every path is wrong, and it names `selected_choice_id` where the server
  requires `selected_answer_id`. **The real contract is
  `apps/web/src/lib/api/edge-functions.ts`.**
- **Constants are forked.** `supabase/functions/_shared/scoring.ts` is a hand-maintained
  Deno copy of `packages/contracts` because Deno cannot import the Node workspace package.
  Change one, change the other.
- **`supabase/tests` never runs.** It is not in the root `workspaces` array, so `npm test`
  skips it — ~85 tests including all RLS coverage. It is also stale and hardcodes
  production credentials as defaults. Do not trust it as a safety net.
- **`packages/contracts/src/scoring.ts` has zero runtime importers.** Only its own test
  imports it. The Edge Functions run the duplicate.

## friday

`friday` is the repo-local dev CLI. It is aimed at an operator who should not
have to know how the pipeline is wired, so it trades composability for a small
number of task-shaped verbs.

```bash
./tools/friday/install     # once per machine — symlinks `friday` onto your PATH
friday check               # machine + secrets + config + repo + code
friday check --quick       # skip lint/types/tests
```

**There is no build step and no install step for updates.** friday is plain Node
ESM with zero dependencies, so the source you pull is the program that runs;
`git pull` is the entire update mechanism. If it ever grows a dependency, the
checksum-and-rebuild logic belongs in `tools/friday/friday`.

`fix`, `preview`, `ship` and `undo` are **not built**. They print what they will
do and exit non-zero — they never pretend to have worked. What exists and what
comes next is in [docs/friday/PLAN.md](docs/friday/PLAN.md).

Two rules friday is built around, both worth knowing before extending it:

1. **Checking a secret must never decrypt it.** `keychain.exists()` deliberately
   omits `-w` so macOS raises no permission dialog. A health check that prompts
   for every secret teaches the operator to click Deny.
2. **Production writes go through GitHub Actions, not the laptop.** friday holds
   no production database password. Reads, checks and native builds are local;
   anything with public impact is dispatched to CI, where the credentials
   already live and every run leaves an audit trail.

## Commands

```bash
npm run dev          # apps/web dev server
npm run build        # build web
npm test             # vitest across workspaces (does NOT include supabase/tests)
npm run typecheck    # tsc --noEmit across workspaces
npm run lint
```

```bash
npm run test:e2e --workspace=apps/web    # playwright
```

CI runs lint → typecheck → test → build → e2e, then deploys to Cloudflare on push to `main`.

## Working agreements

Repository skills live in [.agent/skills/](.agent/skills/) and encode the rules that
apply to this codebase — read the relevant one before working in its area:

| Skill | Applies to |
|---|---|
| [cross-platform-migration](.agent/skills/cross-platform-migration/SKILL.md) | **Temporary.** Web/iOS/Android migration control |
| [release](.agent/skills/release/SKILL.md) | Shipping to web, App Store, Play Store |
| [git-workflow-and-prs](.agent/skills/git-workflow-and-prs/SKILL.md) | Branches, commits, pull requests |
| [contracts-and-schema-first](.agent/skills/contracts-and-schema-first/SKILL.md) | New features, schema changes, domain events |
| [trust-boundary-and-security](.agent/skills/trust-boundary-and-security/SKILL.md) | Data access, Edge Functions, RLS |
| [attempt-lifecycle](.agent/skills/attempt-lifecycle/SKILL.md) | Attempt creation, answers, finalization, resume |
| [server-authoritative-timing](.agent/skills/server-authoritative-timing/SKILL.md) | Timing, countdowns, expiry, anti-cheat |
| [scoring-formula](.agent/skills/scoring-formula/SKILL.md) | Scoring and bonus calculation |
| [error-handling-and-logging](.agent/skills/error-handling-and-logging/SKILL.md) | Error envelopes, structured logging |
| [project-structure](.agent/skills/project-structure/SKILL.md) | Where code lives, domain boundaries |
| [neo-brutalist-ui](.agent/skills/neo-brutalist-ui/SKILL.md) | Any UI component or screen |

Equivalent rules for Cursor live in [.cursor/rules/](.cursor/rules/) — Riley's IDE. They
cover the same ground plus `ui-typography`, `ui-backgrounds`, `ui-accessibility`,
`evented-architecture`, `quiz-publishing` and `rule-creation-guidelines`, which have no
skill equivalent. **Keep the two in sync when you change either.**

Every change carries its proof: schema changes need a migration, access-pattern
changes need RLS updates, and correctness work needs tests in the same PR.

Branch `<type>/<domain>-<slug>` · commit `<type>(<domain>): <imperative summary>` · never
commit to `main` · squash merge · never commit secrets, `.env.local`, keystores or signing
material.

## A note on naming

`apps/web` feeds all three platforms once the migration lands, so the name is slightly
misleading. Renaming it would touch every import path, both workspace configs, CI and the
OpenNext config for zero functional gain — so it stays. Read it as "the client."
