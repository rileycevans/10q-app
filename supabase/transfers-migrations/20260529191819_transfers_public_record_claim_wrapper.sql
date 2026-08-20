-- Public-schema wrapper so PostgREST/the JS client can call the RPC without
-- needing `transfers` added to the exposed db-schemas list. SECURITY DEFINER
-- so it runs with the owner's rights against the transfers schema.
CREATE OR REPLACE FUNCTION public.record_transfer_claim(
  p_player           text,
  p_destination_club text,
  p_source_club      text DEFAULT NULL,
  p_stage            text DEFAULT NULL,
  p_transfer_type    text DEFAULT NULL,
  p_confidence       smallint DEFAULT NULL,
  p_contradicts      boolean DEFAULT false,
  p_journalist_handle text DEFAULT NULL,
  p_outlet           text DEFAULT NULL,
  p_source_url       text DEFAULT NULL,
  p_source_platform  text DEFAULT 'x',
  p_raw_text         text DEFAULT NULL,
  p_reported_at      timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = transfers, public, extensions
AS $$
  SELECT transfers.record_claim(
    p_player, p_destination_club, p_source_club, p_stage,
    p_transfer_type::transfers.transfer_type, p_confidence, p_contradicts,
    p_journalist_handle, p_outlet, p_source_url,
    p_source_platform::transfers.source_platform, p_raw_text, p_reported_at
  );
$$;

-- Only the service role should write claims (ingestion runs service-side).
REVOKE ALL ON FUNCTION public.record_transfer_claim FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_transfer_claim TO service_role;;