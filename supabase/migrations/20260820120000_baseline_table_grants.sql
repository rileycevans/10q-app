-- Baseline table privileges for the PostgREST roles.
--
-- Production has these; a database built from this repo does not, because
-- every table in 20250101000000_initial_schema.sql was created without a
-- single GRANT. Production only has them because Supabase's dashboard applies
-- defaults to tables created through it — defaults that were never captured
-- here.
--
-- The consequence: `supabase start` produces a database where PostgREST
-- cannot read any table, for any role including service_role, with
-- "permission denied for table quizzes". The repo could not reproduce the
-- schema it is supposed to define. Found when the RLS suite ran in CI for the
-- first time and every assertion failed with 42501 — which looked like a
-- catastrophic security regression and was actually a missing GRANT.
--
-- This is NOT a loosening of security. Row Level Security is what restricts
-- access on these tables, and it is enabled on all of them; a table grant
-- without a matching policy still returns nothing.
--
-- IMPORTANT: this migration sorts LAST, so a blanket table-level GRANT would
-- undo the column-level REVOKEs that came before it — re-exposing
-- question_answers.is_correct (the answer key, 20260310100000) and
-- players.linked_auth_user_id (the auth linkage, 20260819140000). Both are
-- re-applied at the end of this file for exactly that reason. The CI
-- invariant assertions in .github/workflows/ci.yml check both and would fail
-- if this were ever got wrong again.
--
-- Mirrors `information_schema.role_table_grants` in production, verified
-- 2026-08-20.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I TO anon, authenticated, service_role',
      t
    );
  END LOOP;
END $$;

-- Sequences, so INSERTs that rely on a default nextval() work.
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO anon, authenticated, service_role', s);
  END LOOP;
END $$;

-- Tables added by later migrations should not have to remember this.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Re-apply the column-level restrictions this file would otherwise undo.
-- ---------------------------------------------------------------------------
--
-- The blanket GRANT above is table-level and therefore covers every column,
-- including the two that must never be client-readable. These REVOKE/GRANT
-- pairs restate 20260310100000 and 20260819140000 so the end state matches
-- what those migrations intended.

-- The answer key. Anyone holding the publishable anon key could otherwise
-- read the current day's correct answers in a single request.
REVOKE SELECT ON public.question_answers FROM anon, authenticated;
GRANT SELECT (id, question_id, body, sort_index, created_at)
  ON public.question_answers TO anon, authenticated;

-- The auth linkage, which de-anonymises players.
REVOKE SELECT ON public.players FROM anon, authenticated;
GRANT SELECT (
  id,
  handle_display,
  handle_canonical,
  handle_last_changed_at,
  created_at,
  current_streak,
  longest_streak,
  last_quiz_date
) ON public.players TO anon, authenticated;
