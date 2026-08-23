-- A public identifier that is not the auth UUID.
--
-- get-profile-by-handle returns `players.id` to anyone holding the
-- publishable anon key, and players.id IS the auth user id for every row.
-- That is a stable cross-session identifier, the join key across every table,
-- and the subject of every RLS policy — published to unauthenticated callers.
--
-- It is not a credential and cannot be used to sign in. But it is the kind of
-- exposure that is harmless right up until one other bug makes it not, and
-- there is no reason a profile page needs it: the client uses the value only
-- to check "is this me?" and hide a Report button.
--
-- Made worse by 20260821090000, which replaced UUID-derived handles with
-- generated ones. That closed a leak but made handles guessable across a
-- ~250k space, so the whole player base can now be walked and mapped to auth
-- UUIDs. This closes the other half.
--
-- Deliberately a NEW column rather than a change to what player_id returns:
-- store binaries stay installed for months (CLAUDE.md rule 5), so the field
-- keeps its name and shape and only stops being the auth UUID.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS public_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Unique so it can identify a player, indexed because the profile endpoint
-- will look up by it.
CREATE UNIQUE INDEX IF NOT EXISTS players_public_id_unique
  ON public.players (public_id);

-- Readable by clients, exactly like the other public profile columns.
-- Table-level SELECT is revoked on this table (20260819140000), so the grant
-- has to name it explicitly or the column is invisible.
GRANT SELECT (public_id) ON public.players TO anon, authenticated;

COMMENT ON COLUMN public.players.public_id IS
  'Stable public identifier. Safe to expose; unlike players.id it is not the auth user id.';
