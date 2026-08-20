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

## Drift found while doing this

Production's migration ledger and the repo do not agree, which is what
motivated the Phase 2 "Supabase in CI" item.

**Three repo migrations are absent from `supabase_migrations.schema_migrations`
in production** — `handle_customization`, `admin_tool_rls_and_snapshots`,
`quiz_content_source`. Verified their objects *do* exist
(`players.handle_last_changed_at`, `quiz_edit_snapshots`,
`quizzes.content_source`), so they were applied under different names or by
hand. The schema is right; the ledger is not.

That is the benign version. The malignant version was
`20260310100000_restrict_is_correct_column.sql`, which had been in the repo
since March and had **never been applied at all** — leaving the answer key
readable with the publishable anon key for five months. See STATUS.md.

Staging exists partly so this stops being possible: migrations applied there
first, from the repo, by CI.

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
