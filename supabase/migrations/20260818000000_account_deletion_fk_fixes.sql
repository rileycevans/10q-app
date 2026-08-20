-- Account deletion support: unblock the two foreign keys that reference a
-- player/auth user without an ON DELETE action.
--
-- Deleting a row from auth.users cascades to public.players (players.id
-- references auth.users ON DELETE CASCADE), and from there to attempts,
-- daily_scores, league_members and leagues. Two constraints defaulted to
-- NO ACTION, which would abort the delete instead:
--
--   1. outbox_events.actor_user_id
--   2. players.linked_auth_user_id
--
-- Required for App Store Guideline 5.1.1(v) and Google Play's account
-- deletion policy, both of which mandate in-app account deletion.

-- ---------------------------------------------------------------------------
-- 1. outbox_events.actor_user_id -> SET NULL
-- ---------------------------------------------------------------------------
-- outbox_events is the event-sourcing log. The events themselves are system
-- history worth keeping after a player leaves, but the actor link is personal
-- data and must go. SET NULL severs the link and preserves the event.
-- actor_user_id is already nullable, so no column change is needed.

ALTER TABLE public.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_events_actor_user_id_fkey;

ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_actor_user_id_fkey
  FOREIGN KEY (actor_user_id)
  REFERENCES public.players(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. players.linked_auth_user_id -> CASCADE
-- ---------------------------------------------------------------------------
-- This column was added in 20250119000000_notion_schema_alignment.sql to hold
-- the auth user id separately from players.id. In practice the two are always
-- the same value (verified against production: 0 rows where they differ), so
-- the row should die with the auth user exactly as players.id already does.

ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_linked_auth_user_id_fkey;

ALTER TABLE public.players
  ADD CONSTRAINT players_linked_auth_user_id_fkey
  FOREIGN KEY (linked_auth_user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Index supporting the SET NULL above
-- ---------------------------------------------------------------------------
-- Without an index on the referencing column, Postgres scans all of
-- outbox_events on every player delete to find rows to null out.

CREATE INDEX IF NOT EXISTS idx_outbox_events_actor_user_id
  ON public.outbox_events (actor_user_id)
  WHERE actor_user_id IS NOT NULL;
