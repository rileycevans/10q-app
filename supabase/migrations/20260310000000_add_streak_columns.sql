-- Add streak tracking columns to players
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS current_streak   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_quiz_date   DATE;
