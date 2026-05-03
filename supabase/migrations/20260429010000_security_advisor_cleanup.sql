-- Address remaining Supabase security-advisor lints flagged alongside the
-- outbox_events RLS fix.

-- ---------------------------------------------------------------------------
-- 1. quiz_play_view: switch to security_invoker so it runs with the caller's
-- privileges (and respects their RLS) rather than the view creator's.
-- The underlying tables (questions, quiz_questions, question_answers,
-- question_tags, tags) already have *_read_published / *_read_public policies
-- that grant the SELECT access this view needs for anon/authenticated.
-- ---------------------------------------------------------------------------
ALTER VIEW public.quiz_play_view SET (security_invoker = on);

-- ---------------------------------------------------------------------------
-- 2. SECURITY DEFINER functions exposed via PostgREST: revoke EXECUTE from
-- PUBLIC (which is how anon inherits access by default), then re-grant to
-- authenticated only. The function bodies still gate via public.is_admin()
-- so an authenticated caller without the admin JWT claim gets nothing back,
-- but anon shouldn't even be able to invoke them via /rest/v1/rpc.
-- publish_scheduled_quiz is cron-only — leave it locked down to no roles.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_question_answers_for_quiz(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_question_answers_for_quiz(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_stats_question_difficulty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_stats_question_difficulty() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.publish_scheduled_quiz() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pin search_path on functions flagged by function_search_path_mutable.
-- These are trigger / cron functions; pinning the search_path prevents a
-- malicious schema-on-the-search-path from shadowing built-in objects.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.enforce_question_timing() SET search_path = public;
ALTER FUNCTION public.assign_quiz_number() SET search_path = public;
ALTER FUNCTION public.publish_scheduled_quiz() SET search_path = public;
ALTER FUNCTION public.prevent_finalized_attempt_updates() SET search_path = public;
ALTER FUNCTION public.prevent_finalized_attempt_answers_updates() SET search_path = public;
