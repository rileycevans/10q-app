-- Claim the next N journalists due for polling. Atomically marks them as
-- last_polled_at=now() so a second concurrent scheduler tick can't double-pick
-- them. Returns the rows the caller should now poll.
CREATE OR REPLACE FUNCTION public.claim_journalists_to_poll(p_limit int DEFAULT 32)
RETURNS TABLE(id uuid, x_handle text, last_seen_tweet_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = transfers, public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM transfers.journalists j
    WHERE j.active = true
      AND j.x_handle IS NOT NULL
      AND j.consecutive_errors < 5  -- back off after repeated failures
    ORDER BY j.last_polled_at ASC NULLS FIRST
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE transfers.journalists j
  SET last_polled_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.id, j.x_handle, j.last_seen_tweet_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_journalists_to_poll(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_journalists_to_poll(int) TO service_role;

-- Record the outcome of a poll: success advances the cursor and resets the
-- error counter; failure increments it and stores the message for debugging.
CREATE OR REPLACE FUNCTION public.record_poll_result(
  p_journalist_id uuid,
  p_newest_tweet_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = transfers, public
AS $$
  UPDATE transfers.journalists
  SET last_seen_tweet_id = coalesce(p_newest_tweet_id, last_seen_tweet_id),
      last_poll_error = p_error,
      consecutive_errors = CASE WHEN p_error IS NULL THEN 0 ELSE consecutive_errors + 1 END
  WHERE id = p_journalist_id;
$$;

REVOKE ALL ON FUNCTION public.record_poll_result(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_poll_result(uuid, text, text) TO service_role;;