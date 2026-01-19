-- Migration: Handle Customization Support
-- Adds handle_last_changed_at column and enforces unique handles

-- Add handle customization tracking
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS handle_last_changed_at TIMESTAMPTZ;

-- Set handle_last_changed_at for existing profiles (use created_at or now)
UPDATE public.profiles
SET handle_last_changed_at = COALESCE(created_at, now())
WHERE handle_last_changed_at IS NULL;

-- Ensure unique handles (drop existing index if it exists, then create unique constraint)
DROP INDEX IF EXISTS profiles_handle_canonical_idx;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_canonical_unique 
  ON public.profiles(handle_canonical);

-- Index for handle lookups (for profile page)
CREATE INDEX IF NOT EXISTS profiles_handle_canonical_lookup_idx 
  ON public.profiles(handle_canonical) 
  WHERE handle_canonical IS NOT NULL;

