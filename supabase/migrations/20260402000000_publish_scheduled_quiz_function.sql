-- ============================================================================
-- publish_scheduled_quiz() — called directly by pg_cron
-- Validates and publishes the next scheduled quiz whose release time has passed.
-- Replaces the old HTTP-based cron job that called the publish-quiz edge function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_scheduled_quiz()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quiz_id UUID;
  v_release_at TIMESTAMPTZ;
  v_question_count INT;
  v_bad_question RECORD;
  v_result jsonb;
BEGIN
  -- 1. Find the most recent scheduled quiz whose release time has passed
  SELECT id, release_at_utc
    INTO v_quiz_id, v_release_at
    FROM public.quizzes
   WHERE status = 'scheduled'
     AND release_at_utc <= now()
   ORDER BY release_at_utc DESC
   LIMIT 1;

  IF v_quiz_id IS NULL THEN
    RETURN jsonb_build_object('published', false, 'message', 'No scheduled quiz ready to publish');
  END IF;

  -- 2. Validate: exactly 10 questions with order_index 1-10
  SELECT count(*) INTO v_question_count
    FROM public.quiz_questions
   WHERE quiz_id = v_quiz_id;

  IF v_question_count <> 10 THEN
    RETURN jsonb_build_object(
      'published', false,
      'error', format('Quiz %s has %s questions, expected 10', v_quiz_id, v_question_count)
    );
  END IF;

  -- 3. Validate each question: 4 answers with sort_index 0-3, exactly 1 correct
  FOR v_bad_question IN
    SELECT qq.question_id,
           count(qa.id) AS answer_count,
           count(qa.id) FILTER (WHERE qa.is_correct) AS correct_count
      FROM public.quiz_questions qq
      LEFT JOIN public.question_answers qa ON qa.question_id = qq.question_id
     WHERE qq.quiz_id = v_quiz_id
     GROUP BY qq.question_id
    HAVING count(qa.id) <> 4
        OR count(qa.id) FILTER (WHERE qa.is_correct) <> 1
  LOOP
    RETURN jsonb_build_object(
      'published', false,
      'error', format(
        'Question %s invalid: %s answers, %s correct (need 4 answers, 1 correct)',
        v_bad_question.question_id,
        v_bad_question.answer_count,
        v_bad_question.correct_count
      )
    );
  END LOOP;

  -- 4. Publish
  UPDATE public.quizzes
     SET status = 'published'
   WHERE id = v_quiz_id;

  -- 5. Write outbox event
  INSERT INTO public.outbox_events (aggregate_type, aggregate_id, event_type, event_version, payload, trace_id)
  VALUES (
    'quiz',
    v_quiz_id,
    'QuizPublished',
    1,
    jsonb_build_object(
      'quiz_id', v_quiz_id,
      'release_at_utc', v_release_at,
      'published_at', now(),
      'source', 'pg_cron'
    ),
    'cron-publish-' || to_char(now(), 'YYYY-MM-DD')
  );

  RETURN jsonb_build_object('published', true, 'quiz_id', v_quiz_id, 'release_at_utc', v_release_at);
END;
$$;

-- ============================================================================
-- Replace the broken HTTP-based cron job with a direct PG function call
-- ============================================================================

SELECT cron.unschedule('publish-quiz-daily');

SELECT cron.schedule(
  'publish-quiz-daily',
  '30 11 * * *',
  $$SELECT public.publish_scheduled_quiz();$$
);
