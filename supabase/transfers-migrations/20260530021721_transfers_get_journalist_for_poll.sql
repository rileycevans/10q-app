-- Public-schema lookup wrapper so the worker doesn't depend on `transfers`
-- being PostgREST-exposed. Service-role only.
CREATE OR REPLACE FUNCTION public.get_journalist_for_poll(p_id uuid)
RETURNS TABLE(x_handle text, last_seen_tweet_id text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = transfers, public
AS $$
  SELECT x_handle, last_seen_tweet_id, active
  FROM transfers.journalists
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.get_journalist_for_poll(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_journalist_for_poll(uuid) TO service_role;;