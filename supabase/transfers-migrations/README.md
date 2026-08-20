# Transfers migrations

**These are not 10Q migrations and must never be applied by 10Q's CI.**

The transfer-credibility system is a separate project that happens to share
10Q's Supabase project. It is isolated in the `transfers` Postgres schema
(9 tables) plus a few `public.*` SECURITY DEFINER wrappers that exist so
PostgREST can reach it without exposing the schema. It does not touch any
quiz table.

## Why these files exist

All 18 were applied through the dashboard/MCP and were **never in any repo**.
Their only copy was the `statements` column of
`supabase_migrations.schema_migrations` in production — that is, the only
record of how the transfers schema was built lived inside the database it
built. Losing that table would have lost the migration history entirely.

They were extracted verbatim from that column on 2026-08-19. Byte lengths
match the ledger exactly.

## Status: recovered, not wired up

Nothing applies these automatically. `supabase/migrations/` is 10Q's
directory and the only one CI touches; keeping these separate is what lets
`supabase db push` work against 10Q at all (see below).

They are ordered by filename and were applied in that order. Two files are
byte-identical duplicates — `20260528204155_seed_journalists.sql` and
`20260528204524_seed_journalists.sql` — because the seed was run twice,
three and a half minutes apart. Both are recorded here because both are in
the ledger; the second was presumably a re-run, and the seed is idempotent.

## If this moves to its own Supabase project

That was always the intent ("could be lifted into its own project later").
The schema isolation makes it clean:

1. Create the project, apply these 18 in filename order.
2. Move the four Edge Functions — `extract-claim`, `ingest-claim`,
   `poll-tweets`, `poll-tweets-batch`.
3. Re-point `run_transfer_poll_batch()`, which hardcodes 10Q's project URL
   in `20260530022738_transfers_cron_scheduler.sql`.
4. Set the `transfers_service_role_key` Vault secret and the
   `ANTHROPIC_API_KEY` function secret in the new project.
5. Drop the `transfers` schema and the `public.*` wrappers from 10Q, and
   delete the 18 ledger rows.

Until then they share a database, and 10Q's ledger carries their 18 rows.
