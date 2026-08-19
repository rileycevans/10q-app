-- C7 — streaks never expired, so the database could not tell you a streak was dead.
--
-- computeStreak only runs inside finalize-attempt. A player who last played on
-- 2026-04-21 still reads current_streak = 15 today; it silently resets on their
-- next finalize. Measured before this migration: 132 of 133 players with a
-- non-zero current_streak had one that was already dead by the game's own rule.
--
-- Two consequences, and the smaller one is the visible one:
--
--   * The home screen reads players.current_streak directly
--     (apps/web/src/app/page.tsx:64), so those 132 players are being shown a
--     streak they no longer have.
--   * Phase 7's streak-at-risk push notification is impossible to build on a
--     column that cannot distinguish "alive" from "abandoned in April".
--
-- Approach: derive rather than mutate. A streak's liveness is a pure function
-- of last_quiz_date and today, so a stored column can always drift; a function
-- cannot. Nothing is written on a schedule, so there is no cron to fail
-- silently and no backfill to get wrong.
--
-- The stored columns are left intact: current_streak remains the value as of
-- the last finalize, which is exactly what finalize-attempt needs as its input
-- for the next computation. Only the *read* path changes.

-- ---------------------------------------------------------------------------
-- The rule, in one place
-- ---------------------------------------------------------------------------
-- A streak is alive if the player finalized today's quiz, or yesterday's.
-- Yesterday counts because today's quiz drops at 11:30 UTC — a player who
-- finished yesterday and has not yet played today has not broken anything.
CREATE OR REPLACE FUNCTION public.is_streak_alive(
  p_last_quiz_date DATE,
  p_today DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_last_quiz_date IS NOT NULL
     AND p_last_quiz_date >= p_today - INTERVAL '1 day';
$$;

COMMENT ON FUNCTION public.is_streak_alive(DATE, DATE) IS
  'True when a streak ending on p_last_quiz_date is still live as of p_today. Yesterday counts: today''s quiz has not necessarily been played yet.';

-- ---------------------------------------------------------------------------
-- The live streak
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.live_current_streak(
  p_current_streak INTEGER,
  p_last_quiz_date DATE,
  p_today DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.is_streak_alive(p_last_quiz_date, p_today) THEN COALESCE(p_current_streak, 0)
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.live_current_streak(INTEGER, DATE, DATE) IS
  'players.current_streak as of today: the stored value if the streak is still alive, otherwise 0. Derived, never written — a stored value drifts, a function cannot.';

-- ---------------------------------------------------------------------------
-- Read path
-- ---------------------------------------------------------------------------
-- A view so clients get the live value without every caller remembering the
-- rule. security_invoker keeps the caller's RLS on players in force rather than
-- running as the view owner.
CREATE OR REPLACE VIEW public.player_streaks
WITH (security_invoker = true)
AS
SELECT
  p.id AS player_id,
  p.handle_display,
  p.current_streak AS stored_current_streak,
  public.live_current_streak(p.current_streak, p.last_quiz_date) AS current_streak,
  p.longest_streak,
  p.last_quiz_date,
  public.is_streak_alive(p.last_quiz_date) AS streak_alive,
  -- Phase 7 needs this: a streak that is alive today but will die at the end of
  -- it is the moment worth notifying about.
  (public.is_streak_alive(p.last_quiz_date)
     AND p.last_quiz_date < CURRENT_DATE) AS streak_at_risk_today
FROM public.players p;

COMMENT ON VIEW public.player_streaks IS
  'Streaks with expiry applied. current_streak here is the live value; players.current_streak is the raw value as of the last finalize and is still what finalize-attempt reads as input. streak_at_risk_today drives Phase 7 notifications.';

GRANT SELECT ON public.player_streaks TO anon, authenticated;
