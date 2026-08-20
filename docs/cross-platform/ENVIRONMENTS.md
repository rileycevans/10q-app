# Environments

Created in Phase 2. Before this there was exactly one environment — production —
so a TestFlight or internal-track binary had nowhere to point that was not live
user data.

## The two Supabase projects

| | Production | Staging |
|---|---|---|
| Project ref | `zcvwamziybpslpavjljw` | `yfzylxospvbipnlbwxno` |
| Name | 10Q | 10Q Staging |
| Region | us-west-2 (Oregon) | us-west-1 (N. California) |
| API URL | `https://zcvwamziybpslpavjljw.supabase.co` | `https://yfzylxospvbipnlbwxno.supabase.co` |
| Plan | Free | Free |
| Purpose | play10q.com and, later, released store builds | TestFlight / Play internal track, and any destructive testing |

Both are in the `rileycevans` organization (`jsfkoxcopxwilkudramq`).

### Free-plan constraints to plan around

- **Two active projects is the ceiling.** A third environment means paying.
- **Free projects pause after 7 days of inactivity.** Harmless for ad-hoc
  testing — you wake it — but a paused project during the Play closed-test
  window would show testers errors. Keep staging warm for those 14 days.

## Keeping them in step

Staging was seeded by applying all 19 repo migrations with
`supabase db push --include-all`, so its schema is derived from the repo rather
than copied from production. That is the point: **the repo is the source of
truth, and staging is the first place that claim gets tested.**

```bash
supabase link --project-ref yfzylxospvbipnlbwxno   # staging
supabase db push                                    # apply new migrations
supabase link --project-ref zcvwamziybpslpavjljw   # ALWAYS relink to prod after
```

The relink matters. `db push` and `functions deploy` act on whatever is linked,
and the failure mode is applying a half-finished migration to production.

## Drift found while doing this — now resolved

Production's ledger and the repo did not agree, which is what motivated the
Phase 2 "Supabase in CI" item.

Three repo migrations were absent from `schema_migrations`
(`handle_customization`, `admin_tool_rls_and_snapshots`, `quiz_content_source`)
though their objects existed, and 17 further rows carried dashboard timestamps
instead of repo filenames. **Reconciled on 2026-08-19** — production now has
exactly the repo's 19 migrations at their repo versions, and `db push` reports
`Remote database is up to date`. See STATUS.md for the procedure and the
rehearsal that de-risked it.

The malignant version of this was
`20260310100000_restrict_is_correct_column.sql`, in the repo since March and
**never applied at all**, leaving the answer key readable with the publishable
anon key for five months.

Staging exists so this stops being possible: migrations are applied there
first, from the repo, by CI, and CI asserts the invariants that were violated.

## The transfers project shares this database

18 migrations in production's ledger belonged to the transfer-credibility
system, which lives in its own `transfers` schema (9 tables) and shares 10Q's
Supabase project. They were applied through the dashboard and existed in no
repo at all.

They are now recovered into `supabase/transfers-migrations/` and their ledger
rows removed, so 10Q's ledger describes only 10Q. Nothing about the transfers
schema or its data changed. If it moves to its own project later — always the
intent — that directory's README has the steps.

## What staging does not have yet

- **No Cloudflare Worker.** The web app still points at production from every
  build config. Pointing a build at staging means a second set of
  `NEXT_PUBLIC_*` values — the `APP_ENVIRONMENT=staging` path through
  `scripts/release/version.mjs` already exists for this.
- **No seeded quiz data.** Staging has the schema and no rows, so the game loop
  will not run there until a quiz is published into it.
- **No auth providers configured.** Google and Apple OAuth redirect URLs are
  per-project and live in the hosted dashboard, so staging currently supports
  anonymous sign-in only.
- **No `MIN_CLIENT_*` secrets**, which is correct — the version gate should stay
  inert in both environments until deliberately armed.
