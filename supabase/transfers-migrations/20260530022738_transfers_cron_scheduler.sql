-- Cron job: every 15 min, hit poll-tweets-batch with batch_size=15.
-- The service-role key is read from Vault; you'll add it manually (one-time).
--
-- The Vault secret name is 'transfers_service_role_key'.

CREATE OR REPLACE FUNCTION public.run_transfer_poll_batch()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_key  text;
  v_req_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'transfers_service_role_key'
  LIMIT 1;

  IF v_key IS NULL THEN
    RAISE NOTICE 'transfers_service_role_key not in vault; skipping poll batch';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://zcvwamziybpslpavjljw.supabase.co/functions/v1/poll-tweets-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('batch_size', 15),
    timeout_milliseconds := 300000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_transfer_poll_batch FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_transfer_poll_batch TO service_role, postgres;

-- Schedule it: every 15 minutes. Will no-op until the vault secret is set.
SELECT cron.schedule(
  'transfer-poll-15min',
  '*/15 * * * *',
  'SELECT public.run_transfer_poll_batch();'
);;