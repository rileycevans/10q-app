# 10Q

A high-stakes daily trivia game.

**Live:** [play10q.com](https://play10q.com)
**Agents:** start at [CLAUDE.md](CLAUDE.md).

## Overview

Every day at **11:30 UTC** a new quiz of **10 multiple-choice questions** drops, simultaneously worldwide. Every player gets identical questions in identical order. One attempt per player per day.

Each question has a **12-second** limit with a step-based speed bonus. Timing and scoring are server-authoritative — the client never computes a score and never sends timing data.

| | |
|---|---|
| Base points | 5 correct / 0 incorrect |
| Speed bonus | 5 under 3s · 4 under 5s · 3 under 7s · 2 under 9s · 1 under 11s · 0 after |
| Max score | 100 (10 × 10) |

## Features

**Gameplay** — 10 questions, 4 answers each, immediate correctness feedback, automatic advance, resumable attempts, permanent results for that day.

**Identity** — anonymous play by default; Google and Apple sign-in upgrade the anonymous account in place, preserving scores, streaks and leagues. Handle customization once every 30 days.

**Streaks** — current and longest, keyed to the quiz's UTC date so they are immune to the player's timezone.

**Leaderboards** — global, over today / 7 / 30 / 365 days, cumulative or average, top-100 or around-me.

**Leagues** — private, invite-code based, with league-scoped leaderboards.

**Stats** — all-time best and worst, per-category performance, public profile at `/u/<handle>`.

## Stack

| Layer | Tech |
|---|---|
| Client | Next.js 16 (App Router), React 19, Tailwind 4, framer-motion |
| Backend | Supabase — Postgres + RLS, 22 Edge Functions, pg_cron |
| Hosting | Cloudflare Workers via OpenNext |
| Analytics | PostHog |
| Errors | Sentry |

Admin authoring lives in a separate repo, `10q-db`.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the Supabase, Sentry and PostHog values.

```bash
npm test
npm run typecheck
npm run lint
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for how it ships.

## Documentation

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Agent entry point — architecture rules and repo map |
| [docs/cross-platform/](docs/cross-platform/) | Web + iOS + Android program |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | How deployment works today |
| `.agent/skills/` | Conventions, as agent skills |
| `.cursor/rules/` | The same conventions for Cursor |

Product specifications live in Confluence (space `MFS`).

## Production domain and DNS

- **Domain:** `play10q.com` · registrar GoDaddy · DNS on Cloudflare (`emma.ns.cloudflare.com`, `vicente.ns.cloudflare.com`)
- Traffic for `play10q.com/*` and `www.play10q.com/*` is served by the **`10q-web` Cloudflare Worker** (`apps/web/wrangler.jsonc`).

`scripts/cloudflare-dns-setup.sh` can restore a baseline DNS configuration if the zone is ever recreated.

> **Note:** the DNS baseline in that script predates the move to Cloudflare Workers and still contains records from an earlier GitHub Pages / Firebase Hosting setup — including `CNAME www → rileycevans.github.io` and `TXT hosting-site=…`. Reconcile it against the live zone before running it.
