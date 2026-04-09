-- Add invite_code column to leagues
ALTER TABLE public.leagues
  ADD COLUMN invite_code TEXT UNIQUE;

-- Generate codes for any existing leagues
UPDATE public.leagues
SET invite_code = upper(substr(md5(random()::text || id::text), 1, 6))
WHERE invite_code IS NULL;

-- Now make it NOT NULL
ALTER TABLE public.leagues
  ALTER COLUMN invite_code SET NOT NULL;

-- Set a default for future inserts
ALTER TABLE public.leagues
  ALTER COLUMN invite_code SET DEFAULT upper(substr(md5(random()::text), 1, 6));
