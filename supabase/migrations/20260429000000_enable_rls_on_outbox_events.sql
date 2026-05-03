-- outbox_events is written only by edge functions using the service_role key,
-- which bypasses RLS. Enabling RLS with no policies blocks anon/authenticated
-- access via PostgREST while leaving the service_role path unaffected.
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
