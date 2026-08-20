CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Accent- and case-insensitive normalization used throughout matching.
-- IMMUTABLE wrapper so it can be used in generated columns / indexes if needed.
CREATE OR REPLACE FUNCTION transfers.norm(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(trim(extensions.unaccent('extensions.unaccent', coalesce(txt, ''))));
$$;

-- Derive the transfer window label from a report timestamp.
-- January => winter; everything else clusters around the summer window.
CREATE OR REPLACE FUNCTION transfers.window_for(ts timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN extract(month FROM ts)::int = 1
      THEN extract(year FROM ts)::int || '-winter'
    ELSE extract(year FROM ts)::int || '-summer'
  END;
$$;;