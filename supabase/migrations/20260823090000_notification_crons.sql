-- Scheduled notifications.
--
-- Both call send-notifications, which owns preferences, dedup and token
-- revocation. These functions decide only WHEN and WHAT.
--
-- The service-role key comes from Vault, the same pattern the transfers poll
-- already uses. Absent, the function logs and returns rather than failing the
-- cron run — a missing secret should not produce an error every day.

CREATE OR REPLACE FUNCTION public.send_daily_drop_notification()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_key text;
  v_req_id bigint;
  v_quiz_number integer;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'transfers_service_role_key' LIMIT 1;

  IF v_key IS NULL THEN
    RAISE NOTICE 'service role key not in vault; skipping daily drop notification';
    RETURN NULL;
  END IF;

  -- Only notify if a quiz actually published today. The publish job can
  -- no-op when nothing is scheduled, and a "new quiz!" notification for a
  -- quiz that does not exist is worse than silence.
  SELECT quiz_number INTO v_quiz_number
  FROM public.quizzes
  WHERE status = 'published'
    AND release_at_utc::date = (now() AT TIME ZONE 'utc')::date
  ORDER BY release_at_utc DESC
  LIMIT 1;

  IF v_quiz_number IS NULL THEN
    RAISE NOTICE 'no quiz published today; skipping daily drop notification';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://zcvwamziybpslpavjljw.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'notification_type', 'daily_drop',
      'title', 'Today''s 10Q is live',
      'body', 'Quiz #' || v_quiz_number || ' just dropped. Ten questions, one shot.',
      'data', jsonb_build_object('route', '/play'),
      -- One send per quiz. A retry, or a second cron firing, cannot
      -- double-notify.
      'dedupe_key', 'daily-drop-' || v_quiz_number
    ),
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

/**
 * Streak-at-risk.
 *
 * Only possible because C7 (20260819130000) made streaks expire on read.
 * Before that, streaks were computed at finalize and never decayed, so the
 * database could not tell you a streak was about to break — it thought every
 * streak was alive forever.
 *
 * Fires late in the UTC day for players who have a live streak and have NOT
 * played today. Deliberately not for streaks of zero: there is nothing at
 * risk, and "your streak of 0 is about to end" is nonsense.
 */
CREATE OR REPLACE FUNCTION public.send_streak_at_risk_notifications()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_key text;
  v_req_id bigint;
  v_at_risk integer;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'transfers_service_role_key' LIMIT 1;

  IF v_key IS NULL THEN
    RAISE NOTICE 'service role key not in vault; skipping streak notifications';
    RETURN NULL;
  END IF;

  -- Anyone worth notifying at all? Skip the call rather than waking the
  -- function to send nothing.
  SELECT count(*) INTO v_at_risk
  FROM public.player_streaks ps
  WHERE ps.current_streak > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.attempts a
      WHERE a.player_id = ps.player_id
        AND a.finalized_at IS NOT NULL
        AND a.finalized_at::date = (now() AT TIME ZONE 'utc')::date
    );

  IF v_at_risk = 0 THEN
    RAISE NOTICE 'no streaks at risk; skipping';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://zcvwamziybpslpavjljw.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'notification_type', 'streak_at_risk',
      'title', 'Your streak ends tonight',
      'body', 'Today''s quiz is still waiting. Keep the run going.',
      'data', jsonb_build_object('route', '/play'),
      'dedupe_key', 'streak-risk-' || (now() AT TIME ZONE 'utc')::date
    ),
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_daily_drop_notification FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_streak_at_risk_notifications FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_daily_drop_notification TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.send_streak_at_risk_notifications TO service_role, postgres;

-- Two minutes after the 11:30 UTC publish, so the quiz exists before anyone
-- is told about it.
SELECT cron.schedule(
  'daily-drop-notification',
  '32 11 * * *',
  'SELECT public.send_daily_drop_notification();'
);

-- 21:00 UTC: late enough to be a real warning, early enough to act on.
-- A fixed UTC hour is wrong for someone in Tokyo; per-timezone sending is a
-- later refinement and needs a timezone on the player row, which does not
-- exist yet.
SELECT cron.schedule(
  'streak-at-risk-notification',
  '0 21 * * *',
  'SELECT public.send_streak_at_risk_notifications();'
);
