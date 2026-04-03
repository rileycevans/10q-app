-- Internal admin tool (10q-db): JWT role=admin policies, quiz edit snapshots,
-- and RPC to read question_answers.is_correct (column grant hides it from direct SELECT).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT auth.jwt())->'app_metadata'->>'role' = 'admin',
    false
  );
$$;

CREATE POLICY "quizzes_admin_all" ON public.quizzes
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "questions_admin_all" ON public.questions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "quiz_questions_admin_all" ON public.quiz_questions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "question_answers_admin_all" ON public.question_answers
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "question_tags_admin_all" ON public.question_tags
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "tags_admin_write" ON public.tags
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Inline JWT checks match existing admin policies on quizzes/questions/etc.
CREATE POLICY "attempt_answers_admin_select" ON public.attempt_answers
  FOR SELECT
  TO authenticated
  USING (coalesce((auth.jwt()->'app_metadata'->>'role') = 'admin', false));

CREATE POLICY "daily_scores_admin_select" ON public.daily_scores
  FOR SELECT
  TO authenticated
  USING (coalesce((auth.jwt()->'app_metadata'->>'role') = 'admin', false));

CREATE TABLE IF NOT EXISTS public.quiz_edit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS quiz_edit_snapshots_quiz_id_idx
  ON public.quiz_edit_snapshots(quiz_id, saved_at DESC);

ALTER TABLE public.quiz_edit_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quiz_edit_snapshots_admin_all" ON public.quiz_edit_snapshots
  FOR ALL
  TO authenticated
  USING (coalesce((auth.jwt()->'app_metadata'->>'role') = 'admin', false))
  WITH CHECK (coalesce((auth.jwt()->'app_metadata'->>'role') = 'admin', false));

GRANT SELECT, INSERT, DELETE ON public.quiz_edit_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_question_answers_for_quiz(p_quiz_id uuid)
RETURNS TABLE (
  id uuid,
  question_id uuid,
  body text,
  is_correct boolean,
  sort_index integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT qa.id, qa.question_id, qa.body, qa.is_correct, qa.sort_index, qa.created_at
  FROM public.question_answers qa
  INNER JOIN public.quiz_questions qq ON qq.question_id = qa.question_id
  WHERE qq.quiz_id = p_quiz_id
    AND public.is_admin();
$$;

GRANT EXECUTE ON FUNCTION public.admin_question_answers_for_quiz(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_stats_question_difficulty()
RETURNS TABLE (
  question_id uuid,
  total bigint,
  correct bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT
    aa.question_id,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE aa.is_correct)::bigint AS correct
  FROM public.attempt_answers aa
  WHERE aa.answer_kind = 'selected'
  GROUP BY aa.question_id
  ORDER BY
    (count(*) FILTER (WHERE aa.is_correct))::double precision
      / NULLIF(count(*), 0)::double precision ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_stats_question_difficulty() TO authenticated;
