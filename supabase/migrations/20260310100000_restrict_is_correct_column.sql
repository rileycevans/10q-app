-- Restrict client access to question_answers.is_correct
-- Only the service role (edge functions) should be able to read is_correct.
-- Column-level grants prevent direct PostgREST queries from seeing is_correct.

REVOKE SELECT ON public.question_answers FROM anon, authenticated;

GRANT SELECT (id, question_id, body, sort_index, created_at)
  ON public.question_answers TO anon, authenticated;
