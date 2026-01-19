-- ============================================================================
-- NOTION SCHEMA ALIGNMENT MIGRATION
-- Aligns database schema with Notion Backend & Data Model (V1) specification
-- ============================================================================

-- ============================================================================
-- PHASE 1: Drop existing quiz-related data (fresh start for dev)
-- ============================================================================

-- Drop dependent tables first (order matters for foreign keys)
DROP TABLE IF EXISTS public.attempt_answers CASCADE;
DROP TABLE IF EXISTS public.attempts CASCADE;
DROP TABLE IF EXISTS public.daily_results CASCADE;
DROP TABLE IF EXISTS private.correct_answers CASCADE;
DROP TABLE IF EXISTS public.question_tags CASCADE;
DROP TABLE IF EXISTS public.question_choices CASCADE;
DROP TABLE IF EXISTS public.questions CASCADE;

-- Drop the old view
DROP VIEW IF EXISTS public.quiz_play_view CASCADE;

-- Keep quizzes table but truncate it
TRUNCATE TABLE public.quizzes CASCADE;

-- ============================================================================
-- PHASE 2: Rename profiles to players (per Notion spec)
-- ============================================================================

-- Drop dependent objects first
DROP TABLE IF EXISTS public.league_members CASCADE;
DROP TABLE IF EXISTS public.leagues CASCADE;

-- Rename profiles to players and restructure
ALTER TABLE public.profiles RENAME TO players;

-- Add linked_auth_user_id column (Notion spec: separate from id)
-- For now, we'll keep the current structure where id = auth user id
-- but add the column for future flexibility
ALTER TABLE public.players 
  ADD COLUMN IF NOT EXISTS linked_auth_user_id UUID REFERENCES auth.users(id);

-- Update existing rows to have linked_auth_user_id = id
UPDATE public.players SET linked_auth_user_id = id WHERE linked_auth_user_id IS NULL;

-- ============================================================================
-- PHASE 3: Create Content Tables (Notion spec)
-- ============================================================================

-- Tags table (normalized)
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Questions table (no quiz_id - reusable across quizzes)
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Question answers table (with is_correct per Notion spec)
CREATE TABLE IF NOT EXISTS public.question_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  sort_index INT NOT NULL CHECK (sort_index BETWEEN 0 AND 3),
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, sort_index)
);

-- Question tags junction table (with tag_id FK per Notion spec)
CREATE TABLE IF NOT EXISTS public.question_tags (
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

-- Quiz questions junction table (links quizzes to questions)
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  order_index INT NOT NULL CHECK (order_index BETWEEN 1 AND 10),
  PRIMARY KEY (quiz_id, question_id),
  UNIQUE (quiz_id, order_index)
);

-- ============================================================================
-- PHASE 4: Recreate Gameplay Tables (updated for Notion spec)
-- ============================================================================

-- Attempts table (references players instead of profiles)
CREATE TABLE IF NOT EXISTS public.attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  current_index INT NOT NULL DEFAULT 1 CHECK (current_index BETWEEN 1 AND 11),
  current_question_started_at TIMESTAMPTZ,
  current_question_expires_at TIMESTAMPTZ,
  total_score NUMERIC NOT NULL DEFAULT 0,
  total_time_ms INT NOT NULL DEFAULT 0,
  UNIQUE(player_id, quiz_id)
);

-- Attempt answers table (references question_answers instead of question_choices)
CREATE TABLE IF NOT EXISTS public.attempt_answers (
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  answer_kind TEXT NOT NULL CHECK (answer_kind IN ('selected', 'timeout')),
  selected_answer_id UUID REFERENCES public.question_answers(id),
  is_correct BOOLEAN NOT NULL,
  time_ms INT NOT NULL CHECK (time_ms BETWEEN 0 AND 16000),
  base_points INT NOT NULL,
  bonus_points NUMERIC NOT NULL CHECK (bonus_points BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id),
  CHECK (
    (answer_kind = 'selected' AND selected_answer_id IS NOT NULL) OR
    (answer_kind = 'timeout' AND selected_answer_id IS NULL)
  )
);

-- Daily scores table (per Notion spec naming)
CREATE TABLE IF NOT EXISTS public.daily_scores (
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL,
  score NUMERIC NOT NULL,
  total_time_ms INT NOT NULL,
  correct_count INT NOT NULL CHECK (correct_count BETWEEN 0 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, player_id)
);

-- ============================================================================
-- PHASE 5: Recreate Leagues Tables (updated for Notion spec)
-- ============================================================================

-- Leagues table (owner_player_id per Notion spec)
CREATE TABLE IF NOT EXISTS public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- League members table
CREATE TABLE IF NOT EXISTS public.league_members (
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, player_id)
);

-- ============================================================================
-- PHASE 6: Create Indexes
-- ============================================================================

-- Quiz indexes
CREATE INDEX IF NOT EXISTS quizzes_status_release_idx 
  ON public.quizzes (status, release_at_utc DESC);

-- Question indexes
CREATE INDEX IF NOT EXISTS questions_created_at_idx 
  ON public.questions (created_at DESC);

-- Quiz questions indexes
CREATE INDEX IF NOT EXISTS quiz_questions_quiz_id_idx 
  ON public.quiz_questions (quiz_id);
CREATE INDEX IF NOT EXISTS quiz_questions_question_id_idx 
  ON public.quiz_questions (question_id);

-- Attempt indexes
CREATE INDEX IF NOT EXISTS attempts_player_id_idx 
  ON public.attempts (player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS attempts_quiz_id_idx 
  ON public.attempts (quiz_id);

-- Daily scores indexes (for leaderboards)
CREATE INDEX IF NOT EXISTS daily_scores_completed_at_idx 
  ON public.daily_scores (completed_at DESC);
CREATE INDEX IF NOT EXISTS daily_scores_quiz_score_idx 
  ON public.daily_scores (quiz_id, score DESC, total_time_ms ASC, completed_at ASC, player_id ASC);
CREATE INDEX IF NOT EXISTS daily_scores_player_idx 
  ON public.daily_scores (player_id, completed_at DESC);

-- Tags indexes
CREATE INDEX IF NOT EXISTS tags_slug_idx ON public.tags (slug);
CREATE INDEX IF NOT EXISTS tags_name_idx ON public.tags (name);

-- ============================================================================
-- PHASE 7: Create Views
-- ============================================================================

-- Quiz play view (public, excludes is_correct for security)
CREATE OR REPLACE VIEW public.quiz_play_view AS
SELECT 
  q.id AS question_id,
  qq.quiz_id,
  q.body,
  qq.order_index,
  qa.id AS answer_id,
  qa.body AS answer_body,
  qa.sort_index AS answer_sort_index,
  array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL) AS tags
FROM public.questions q
JOIN public.quiz_questions qq ON q.id = qq.question_id
LEFT JOIN public.question_answers qa ON q.id = qa.question_id
LEFT JOIN public.question_tags qt ON q.id = qt.question_id
LEFT JOIN public.tags t ON qt.tag_id = t.id
GROUP BY q.id, qq.quiz_id, q.body, qq.order_index, qa.id, qa.body, qa.sort_index
ORDER BY qq.order_index, qa.sort_index;

-- ============================================================================
-- PHASE 8: Enable RLS on all tables
-- ============================================================================

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PHASE 9: Create RLS Policies
-- ============================================================================

-- Drop existing policies first (they reference old table names)
DROP POLICY IF EXISTS "profiles_read_own" ON public.players;
DROP POLICY IF EXISTS "profiles_read_public" ON public.players;
DROP POLICY IF EXISTS "quizzes_read_published" ON public.quizzes;

-- Tags: public read
CREATE POLICY "tags_read_public" ON public.tags
  FOR SELECT USING (true);

-- Quizzes: public read of published quizzes
CREATE POLICY "quizzes_read_published" ON public.quizzes
  FOR SELECT
  USING (status = 'published');

-- Quiz questions: public read for published quizzes
CREATE POLICY "quiz_questions_read_published" ON public.quiz_questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quizzes qz 
      WHERE qz.id = quiz_questions.quiz_id 
      AND qz.status = 'published'
    )
  );

-- Questions: public read for questions in published quizzes
CREATE POLICY "questions_read_published" ON public.questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quiz_questions qq
      JOIN public.quizzes qz ON qz.id = qq.quiz_id
      WHERE qq.question_id = questions.id
      AND qz.status = 'published'
    )
  );

-- Question answers: public read for questions in published quizzes
-- NOTE: is_correct is in the table but Edge Functions control access
CREATE POLICY "question_answers_read_published" ON public.question_answers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questions q
      JOIN public.quiz_questions qq ON qq.question_id = q.id
      JOIN public.quizzes qz ON qz.id = qq.quiz_id
      WHERE q.id = question_answers.question_id
      AND qz.status = 'published'
    )
  );

-- Question tags: public read for questions in published quizzes
CREATE POLICY "question_tags_read_published" ON public.question_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questions q
      JOIN public.quiz_questions qq ON qq.question_id = q.id
      JOIN public.quizzes qz ON qz.id = qq.quiz_id
      WHERE q.id = question_tags.question_id
      AND qz.status = 'published'
    )
  );

-- Players: public read of handles, own read of full profile
CREATE POLICY "players_read_public" ON public.players
  FOR SELECT USING (true);

-- Attempts: users can read their own only
CREATE POLICY "attempts_read_own" ON public.attempts
  FOR SELECT
  USING (auth.uid() = player_id);

-- Attempt answers: users can read their own only
CREATE POLICY "attempt_answers_read_own" ON public.attempt_answers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.attempts a 
      WHERE a.id = attempt_answers.attempt_id 
      AND a.player_id = auth.uid()
    )
  );

-- Daily scores: users can read their own only
CREATE POLICY "daily_scores_read_own" ON public.daily_scores
  FOR SELECT
  USING (auth.uid() = player_id);

-- Leagues: members can read their league
CREATE POLICY "leagues_read_member" ON public.leagues
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm 
      WHERE lm.league_id = leagues.id 
      AND lm.player_id = auth.uid()
    )
  );

-- League members: members can read their league's members
CREATE POLICY "league_members_read_member" ON public.league_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm 
      WHERE lm.league_id = league_members.league_id 
      AND lm.player_id = auth.uid()
    )
  );

-- ============================================================================
-- PHASE 10: Create Triggers
-- ============================================================================

-- Prevent updates to finalized attempts
CREATE OR REPLACE FUNCTION prevent_finalized_attempt_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Attempt is finalized and cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attempts_prevent_finalized_updates ON public.attempts;
CREATE TRIGGER attempts_prevent_finalized_updates
  BEFORE UPDATE ON public.attempts
  FOR EACH ROW
  WHEN (OLD.finalized_at IS NOT NULL)
  EXECUTE FUNCTION prevent_finalized_attempt_updates();

-- Prevent updates to attempt_answers after attempt is finalized
CREATE OR REPLACE FUNCTION prevent_finalized_attempt_answers_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.attempts a 
    WHERE a.id = NEW.attempt_id 
    AND a.finalized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Attempt is finalized and answers cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attempt_answers_prevent_finalized_updates ON public.attempt_answers;
CREATE TRIGGER attempt_answers_prevent_finalized_updates
  BEFORE INSERT OR UPDATE ON public.attempt_answers
  FOR EACH ROW
  EXECUTE FUNCTION prevent_finalized_attempt_answers_updates();

-- Ensure current_question_expires_at = current_question_started_at + 16s
CREATE OR REPLACE FUNCTION enforce_question_timing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_question_started_at IS NOT NULL THEN
    NEW.current_question_expires_at := NEW.current_question_started_at + INTERVAL '16 seconds';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attempts_enforce_timing ON public.attempts;
CREATE TRIGGER attempts_enforce_timing
  BEFORE INSERT OR UPDATE ON public.attempts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_question_timing();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Schema now matches Notion Backend & Data Model (V1) specification:
-- - players table (renamed from profiles)
-- - questions table (no quiz_id, body field)
-- - question_answers table (with is_correct, sort_index 0-3)
-- - tags table (normalized)
-- - question_tags junction (with tag_id FK)
-- - quiz_questions junction (links quizzes to questions)
-- - daily_scores table (renamed from daily_results)
-- ============================================================================
