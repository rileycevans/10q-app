-- ---------------------------------------------------------------------------
-- match_club: find an existing club by name/short_name/alias, accent-insensitive.
-- Returns NULL if no confident match. Does NOT create.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfers.match_club(raw_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  n text := transfers.norm(raw_name);
  hit uuid;
BEGIN
  IF n = '' THEN
    RETURN NULL;
  END IF;

  -- 1) exact normalized match on canonical name or short_name
  SELECT id INTO hit FROM transfers.clubs
  WHERE transfers.norm(name) = n OR transfers.norm(short_name) = n
  LIMIT 1;
  IF hit IS NOT NULL THEN RETURN hit; END IF;

  -- 2) normalized match against any alias
  SELECT c.id INTO hit
  FROM transfers.clubs c, unnest(c.aliases) a
  WHERE transfers.norm(a) = n
  LIMIT 1;
  RETURN hit;  -- may be NULL
END;
$$;

-- ---------------------------------------------------------------------------
-- resolve_or_create_club: match, else lazily create (cross-league moves).
-- New clubs get league_id=NULL and the optional country; the raw + normalized
-- name are seeded as aliases so future spellings collapse onto this row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfers.resolve_or_create_club(raw_name text, country_hint text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  cleaned text := trim(raw_name);
  hit uuid;
BEGIN
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  hit := transfers.match_club(cleaned);
  IF hit IS NOT NULL THEN RETURN hit; END IF;

  INSERT INTO transfers.clubs (name, aliases, league_id, country)
  VALUES (cleaned, ARRAY[cleaned], NULL, country_hint)
  RETURNING id INTO hit;

  RETURN hit;
END;
$$;

-- ---------------------------------------------------------------------------
-- resolve_or_create_player: exact / alias / accent-insensitive match,
-- else create. New players seed aliases with the raw name (normalized lookups
-- handle accents). Conservative on purpose: no trigram fuzzy auto-merge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfers.resolve_or_create_player(raw_name text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  cleaned text := trim(raw_name);
  n text := transfers.norm(raw_name);
  hit uuid;
BEGIN
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- 1) exact normalized name
  SELECT id INTO hit FROM transfers.players
  WHERE transfers.norm(name) = n
  LIMIT 1;
  IF hit IS NOT NULL THEN RETURN hit; END IF;

  -- 2) normalized alias match
  SELECT p.id INTO hit
  FROM transfers.players p, unnest(p.aliases) a
  WHERE transfers.norm(a) = n
  LIMIT 1;
  IF hit IS NOT NULL THEN RETURN hit; END IF;

  -- 3) lazy create
  INSERT INTO transfers.players (name, aliases)
  VALUES (cleaned, ARRAY[cleaned])
  RETURNING id INTO hit;

  RETURN hit;
END;
$$;;