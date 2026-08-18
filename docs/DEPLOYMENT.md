# Deployment

How 10Q ships today. For the multi-platform release architecture — web + iOS + Android as three independently controllable channels — see [cross-platform/release/](cross-platform/release/).

> This document describes **what exists now**. It deliberately does not describe the target state.

## Targets

| Component | Target | Trigger |
|---|---|---|
| Web app | Cloudflare Workers via OpenNext | automatic, on push to `main` |
| Supabase migrations | hosted Supabase project | **manual** |
| Supabase Edge Functions (22) | hosted Supabase project | **manual** |

There is **one environment: production.** No staging exists in Cloudflare, Supabase, Sentry or PostHog. Local development writes into the production PostHog project.

## Web

`.github/workflows/ci.yml` defines both jobs.

**Job `ci`** — runs on every PR and every push to `main`:

```
npm ci → lint → typecheck → test → build → playwright install → test:e2e
```

**Job `deploy`** — `needs: ci`, and only on push to `main`:

```bash
npm run deploy --workspace=apps/web
```

which is `opennextjs-cloudflare build && opennextjs-cloudflare deploy`.

`apps/web/wrangler.jsonc` declares worker `10q-web`, `main: ".open-next/worker.js"`, assets from `.open-next/assets`, and routes `play10q.com/*` and `www.play10q.com/*`. There are no `[env.*]` blocks, no `vars`, and no KV/D1/R2/Queue bindings — all runtime config is inlined at build time through `NEXT_PUBLIC_*`.

`apps/web/open-next.config.ts` is a bare `defineCloudflareConfig()`. Note `patches/@opennextjs+cloudflare+1.17.1.patch`, applied by the root `postinstall` — the adapter is locally patched and version-pinned, which is a standing upgrade cost.

### Known defect

`NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are supplied to the **deploy** job but not the **ci** build job. Because `NEXT_PUBLIC_*` is inlined at build time, **the artifact CI verifies has analytics compiled out while the artifact users receive has it compiled in.** Both jobs also carry `SENTRY_AUTH_TOKEN`, so each merge can produce two source-map uploads from two non-identical builds. Fix before adding a third build target.

### Rollback

Cloudflare Workers keeps prior versions; roll back through the Cloudflare dashboard or `wrangler`. There is no scripted rollback and no post-deploy smoke test. See [cross-platform/release/ROLLBACKS.md](cross-platform/release/ROLLBACKS.md).

## Supabase

Not in CI. Deployed by hand against the single hosted project.

```bash
supabase db push
supabase functions deploy <name>
```

**Ordering rule:** backward-compatible backend changes deploy **before** the clients that need them — never after. This matters more once store binaries exist, because an installed app can lag a contract change by weeks. See the version-skew rule in [cross-platform/release/RELEASE_ARCHITECTURE.md](cross-platform/release/RELEASE_ARCHITECTURE.md).

**Verify before assuming the daily publish works.** `publish_scheduled_quiz()` selects `WHERE status = 'scheduled'`, but the only CHECK constraint in migration history is `CHECK (status IN ('draft','published','archived'))`. Either the constraint was changed by hand in the dashboard — making migrations non-reproducible — or the cron has matched zero rows since 2026-04-02. See C9 in [cross-platform/03-blocking-fixes.md](cross-platform/03-blocking-fixes.md).

### Scheduled job

One pg_cron job, `publish-quiz-daily`, at `30 11 * * *` (11:30 UTC), calling `public.publish_scheduled_quiz()` in-database. It no longer goes over HTTP.

The `publish-quiz` **Edge Function** is therefore vestigial — and it is **unauthenticated**, so anyone who knows the URL can publish a quiz early. See A2 in [cross-platform/03-blocking-fixes.md](cross-platform/03-blocking-fixes.md).

## Environment variables

`apps/web/.env.example` is the reference. Seven variables:

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + Edge Function base URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry (absent locally, so Sentry is production-only) |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | source-map upload at build time |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | analytics |

`SUPABASE_SERVICE_ROLE_KEY` is used only by Edge Functions and `scripts/`. It must never appear under `apps/web/src`.

The release identifiers (`app_version`, `app_build`, `release_sha`, `client_platform`, `environment`) do **not exist yet** — see [cross-platform/OBSERVABILITY.md](cross-platform/OBSERVABILITY.md).

## Gaps

Carried into [cross-platform/05-migration-plan.md](cross-platform/05-migration-plan.md) Phase 2:

- No staging environment anywhere
- No version source of truth; zero git tags; all `package.json` files frozen at `0.1.0`
- Supabase not in CI
- No post-deploy smoke test
- No scripted rollback
- CI/deploy build divergence (above)
