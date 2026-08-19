-- C1 — the database contradicted the code by 4 seconds.
--
-- enforce_question_timing() unconditionally overwrote
-- current_question_expires_at with started_at + 16 seconds on every insert or
-- update of attempts, discarding whatever the Edge Function computed. Every
-- code path uses QUESTION_TIME_LIMIT_MS = 12000
-- (packages/contracts/src/constants.ts, supabase/functions/_shared/scoring.ts).
--
-- Verified before this migration: all 66 attempts with timing rows had a
-- persisted window of exactly 16 seconds.
--
-- Why it matters, precisely. submit-answer does NOT read the persisted expiry —
-- it recomputes elapsed from current_question_started_at against the 12000ms
-- constant — so scoring has always been correct. The damage is on the read
-- path: apps/web/src/app/play/q/[index]/page.tsx:106 reads
-- current_question_expires_at, so on any resume the UI counts down a 16s
-- deadline while the server scores against 12s. The player sees four seconds
-- that do not exist, and a native client trusting this column inherits the same
-- bug — which is why the plan requires this to land before any mobile timer
-- work.
--
-- 12000ms is the source of truth. The trigger is brought to match the code
-- rather than the other way round.

CREATE OR REPLACE FUNCTION public.enforce_question_timing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_question_started_at IS NOT NULL THEN
    -- Keep in step with QUESTION_TIME_LIMIT_MS (12000) in
    -- packages/contracts/src/constants.ts and _shared/scoring.ts.
    NEW.current_question_expires_at :=
      NEW.current_question_started_at + INTERVAL '12 seconds';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The CHECK on attempt_answers.time_ms was the same 16s leftover.
--
-- 10 existing rows exceed 12000ms and would make a naive tightening abort:
-- 7 timeouts clamped to exactly 16000, and 3 'selected' answers between 12.0s
-- and 15.8s that were SCORED — two of them correct, for 5 base points each.
-- Those three are the 16s window's real cost: answers the server should have
-- treated as timeouts but did not.
--
-- Historical scores are deliberately NOT rewritten. They are recorded results
-- that players saw, the totals are already on leaderboards, and silently
-- restating them would be worse than the 10-point inconsistency it corrects.
-- The constraint is therefore applied NOT VALID: it binds every future write
-- while leaving history intact and visible.
ALTER TABLE public.attempt_answers
  DROP CONSTRAINT IF EXISTS attempt_answers_time_ms_check;

ALTER TABLE public.attempt_answers
  ADD CONSTRAINT attempt_answers_time_ms_check
  CHECK (time_ms >= 0 AND time_ms <= 12000) NOT VALID;

-- Existing rows: bring stale 16s expiries in line so a resume on an attempt
-- started before this migration does not still read four extra seconds.
-- Only live attempts are touched; finalized ones are history.
UPDATE public.attempts
SET current_question_expires_at = current_question_started_at + INTERVAL '12 seconds'
WHERE finalized_at IS NULL
  AND current_question_started_at IS NOT NULL
  AND current_question_expires_at <> current_question_started_at + INTERVAL '12 seconds';
