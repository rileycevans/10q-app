-- Remove questions that are not linked to any quiz and have no attempt answers.
DELETE FROM public.questions q
WHERE NOT EXISTS (SELECT 1 FROM public.quiz_questions qq WHERE qq.question_id = q.id)
  AND NOT EXISTS (SELECT 1 FROM public.attempt_answers aa WHERE aa.question_id = q.id);

-- Remove draft quizzes that never received any linked questions (failed creates).
DELETE FROM public.quizzes q
WHERE q.status = 'draft'
  AND NOT EXISTS (SELECT 1 FROM public.quiz_questions qq WHERE qq.quiz_id = q.id);
