-- Add invite_expires_at column to leagues for link-based invites (7 day expiration)
ALTER TABLE public.leagues
  ADD COLUMN invite_expires_at TIMESTAMPTZ;

-- Set expiration for existing leagues (7 days from now)
UPDATE public.leagues
SET invite_expires_at = NOW() + INTERVAL '7 days'
WHERE invite_expires_at IS NULL;

-- Make it NOT NULL after setting values
ALTER TABLE public.leagues
  ALTER COLUMN invite_expires_at SET NOT NULL;

-- Set default for new leagues (7 days from creation)
ALTER TABLE public.leagues
  ALTER COLUMN invite_expires_at SET DEFAULT (NOW() + INTERVAL '7 days');
