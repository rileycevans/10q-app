-- Narrow rate limiting for the unauthenticated endpoints.
--
-- No Edge Function throttles anything today. get-profile-by-handle is the
-- worst of it: unauthenticated, service-role, a heavy multi-join measured at
-- 2.27s per call — the cheapest DoS surface in the app. Handles are also
-- guessable across a ~250k space since 20260821090000, so the same endpoint
-- is the enumeration path.
--
-- Deliberately NOT a general-purpose limiter. The migration plan defers that
-- to its own workstream because a bespoke per-function one gets thrown away,
-- and that reasoning still holds. This is the smallest thing that makes
-- enumeration and the DoS surface impractical, and it is easy to delete when
-- a real limiter (or edge-level throttling) replaces it.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- Caller identity plus endpoint. For unauthenticated callers that is an IP;
  -- the shape allows a user id later without a schema change.
  bucket_key text NOT NULL,
  endpoint text NOT NULL,
  -- Start of the fixed window this row counts.
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket_key, endpoint, window_start)
);

-- RLS on, no policies: only the service role reaches this, and only from
-- inside an Edge Function. A client has no reason to read or write it.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Sweeping old windows keeps the table small. Called opportunistically by the
-- checker rather than on a schedule, so there is no cron dependency.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON public.rate_limits (window_start);

/**
 * Count a request and report whether it is over the limit.
 *
 * Fixed window rather than a sliding one: it is a single upsert, and the
 * worst case (2x the limit across a window boundary) is irrelevant at the
 * scale this defends against.
 *
 * Returns true when the request should be ALLOWED.
 */
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket_key text,
  p_endpoint text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  -- Truncate to the window so every caller in the same period shares a row.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (bucket_key, endpoint, window_start, request_count)
  VALUES (p_bucket_key, p_endpoint, v_window_start, 1)
  ON CONFLICT (bucket_key, endpoint, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  -- Opportunistic cleanup, roughly 1 call in 100, so the table cannot grow
  -- without bound and nothing has to schedule a sweep.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits
    WHERE window_start < now() - interval '1 hour';
  END IF;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit TO service_role;
