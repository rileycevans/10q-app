-- Add sequential quiz_number to quizzes for share cards ("10Q #47")
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS quiz_number INTEGER;

-- Sequence for future quizzes
CREATE SEQUENCE IF NOT EXISTS quiz_number_seq START 1;

-- Assign numbers to any existing quizzes, ordered by release date
UPDATE public.quizzes
SET quiz_number = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY release_at_utc ASC) AS rn
  FROM public.quizzes
) sub
WHERE public.quizzes.id = sub.id
  AND public.quizzes.quiz_number IS NULL;

-- Advance sequence past highest existing number
SELECT setval('quiz_number_seq', COALESCE(MAX(quiz_number), 0) + 1, false)
FROM public.quizzes;

-- Auto-assign quiz_number on insert
CREATE OR REPLACE FUNCTION public.assign_quiz_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quiz_number IS NULL THEN
    NEW.quiz_number := nextval('quiz_number_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_quiz_number ON public.quizzes;
CREATE TRIGGER trg_assign_quiz_number
  BEFORE INSERT ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION public.assign_quiz_number();
