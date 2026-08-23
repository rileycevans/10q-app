-- Replace auto-generated handles that leak the auth UUID.
--
-- Until 2026-08-21, a player created without choosing a handle got
-- `Player` + the first eight hex characters of their auth UUID —
-- `Playerb78c2f4e`. That is published on the global leaderboard and to every
-- league they join: a stable fragment of a user identifier that nobody chose
-- to share, visible to strangers.
--
-- start-attempt and create-league now generate `AdjectiveNoun00` instead, but
-- that only helps new signups. At the time of writing 176 of 185 players
-- carry the leaking form and 127 of them appear on the leaderboard.
--
-- Safe to rewrite because NONE of them were chosen: every affected row has
-- handle_last_changed_at IS NULL, so no player is losing a name they picked.
-- The guard below enforces that rather than trusting the observation.

DO $$
DECLARE
  adjectives text[] := ARRAY[
    'Swift','Bold','Clever','Mighty','Brave','Fierce','Noble','Wise','Rapid','Sharp',
    'Silent','Golden','Cosmic','Turbo','Mega','Ultra','Hyper','Super','Prime','Epic',
    'Lucky','Wild','Royal','Storm','Blaze','Frost','Shadow','Bright','Iron','Steel',
    'Crystal','Diamond','Ruby','Jade','Amber','Scarlet','Azure','Violet','Emerald','Onyx',
    'Rogue','Stellar','Lunar','Solar','Atomic','Quantum','Neon','Vivid','Grand','Elite'
  ];
  nouns text[] := ARRAY[
    'Falcon','Tiger','Dragon','Phoenix','Wolf','Eagle','Shark','Panther','Cobra','Raven',
    'Hawk','Lion','Bear','Fox','Lynx','Puma','Jaguar','Viper','Python','Griffin',
    'Titan','Comet','Meteor','Rocket','Blade','Arrow','Hammer','Shield','Knight','Ranger',
    'Pilot','Captain','Sage','Scout','Nomad','Pioneer','Voyager','Ace','Champion','Legend',
    'Spark','Bolt','Flame','Wave','Storm','Peak','Ridge','River','Summit','Quest'
  ];
  r record;
  candidate_display text;
  candidate_canonical text;
  tries int;
  renamed int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.players
    WHERE handle_display ~ '^Player[0-9a-f]{8}$'
      -- Never rewrite a handle someone actually chose, even if it happens to
      -- match the pattern.
      AND handle_last_changed_at IS NULL
  LOOP
    tries := 0;

    LOOP
      tries := tries + 1;
      candidate_display :=
        adjectives[1 + floor(random() * array_length(adjectives, 1))::int] ||
        nouns[1 + floor(random() * array_length(nouns, 1))::int] ||
        lpad(floor(random() * 100)::text, 2, '0');
      candidate_canonical := lower(candidate_display);

      -- handle_canonical is UNIQUE, so check before writing rather than
      -- letting the constraint abort the whole migration.
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.players WHERE handle_canonical = candidate_canonical
      );

      IF tries >= 20 THEN
        RAISE EXCEPTION 'Could not find a free handle for player % after % tries', r.id, tries;
      END IF;
    END LOOP;

    UPDATE public.players
    SET handle_display = candidate_display,
        handle_canonical = candidate_canonical
        -- handle_last_changed_at stays NULL: the player still has not chosen
        -- a handle, and setting it would start their 30-day change cooldown
        -- for a rename they did not ask for.
    WHERE id = r.id;

    renamed := renamed + 1;
  END LOOP;

  RAISE NOTICE 'Renamed % auto-generated handles', renamed;
END $$;
