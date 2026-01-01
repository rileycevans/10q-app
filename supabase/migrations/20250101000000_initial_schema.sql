-- 10Q Initial Schema Migration
-- Creates all core tables, constraints, RLS policies, and views

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- SCHEMAS
-- ============================================================================

-- Create private schema for sensitive data
CREATE SCHEMA IF NOT EXISTS private;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Quizzes table
CREATE TABLE IF NOT EXISTS public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_at_utc TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one published quiz per release time
CREATE UNIQUE INDEX IF NOT EXISTS quizzes_release_unique 
  ON public.quizzes (release_at_utc) 
  WHERE status = 'published';

-- Questions table
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  order_index INT NOT NULL CHECK (order_index BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(quiz_id, order_index)
);

-- Question choices table
CREATE TABLE IF NOT EXISTS public.question_choices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  order_index INT NOT NULL CHECK (order_index BETWEEN 1 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, order_index)
);

-- Private correct answers table (locked, no client access)
CREATE TABLE IF NOT EXISTS private.correct_answers (
  question_id UUID PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
  correct_choice_id UUID NOT NULL REFERENCES public.question_choices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Question tags table (many-to-many)
CREATE TABLE IF NOT EXISTS public.question_tags (
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (question_id, tag)
);

-- Profiles table (keyed by Supabase Auth users.id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle_display TEXT NOT NULL,
  handle_canonical TEXT UNIQUE NOT NULL,
  handle_last_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attempts table
CREATE TABLE IF NOT EXISTS public.attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  current_index INT NOT NULL DEFAULT 1 CHECK (current_index BETWEEN 1 AND 11),
  current_question_started_at TIMESTAMPTZ,
  current_question_expires_at TIMESTAMPTZ,
  total_score NUMERIC NOT NULL DEFAULT 0,
  total_time_ms INT NOT NULL DEFAULT 0,
  UNIQUE(player_id, quiz_id)
);

-- Attempt answers table
CREATE TABLE IF NOT EXISTS public.attempt_answers (
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  answer_kind TEXT NOT NULL CHECK (answer_kind IN ('selected', 'timeout')),
  selected_answer_id UUID REFERENCES public.question_choices(id),
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

-- Daily results table (immutable, append-only)
CREATE TABLE IF NOT EXISTS public.daily_results (
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL,
  score NUMERIC NOT NULL,
  total_time_ms INT NOT NULL,
  correct_count INT NOT NULL CHECK (correct_count BETWEEN 0 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, player_id)
);

-- Outbox events table (for evented architecture)
CREATE TABLE IF NOT EXISTS public.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_version INT NOT NULL DEFAULT 1,
  idempotency_key TEXT,
  actor_user_id UUID REFERENCES public.profiles(id),
  payload JSONB NOT NULL,
  trace_id TEXT,
  published_at TIMESTAMPTZ
);

-- Leagues table (for Phase 4)
CREATE TABLE IF NOT EXISTS public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- League members table
CREATE TABLE IF NOT EXISTS public.league_members (
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, player_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Quiz indexes
CREATE INDEX IF NOT EXISTS quizzes_status_release_idx 
  ON public.quizzes (status, release_at_utc DESC);

-- Question indexes
CREATE INDEX IF NOT EXISTS questions_quiz_id_idx 
  ON public.questions (quiz_id);

-- Attempt indexes
CREATE INDEX IF NOT EXISTS attempts_player_id_idx 
  ON public.attempts (player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS attempts_quiz_id_idx 
  ON public.attempts (quiz_id);

-- Daily results indexes (for leaderboards)
CREATE INDEX IF NOT EXISTS daily_results_completed_at_idx 
  ON public.daily_results (completed_at DESC);
CREATE INDEX IF NOT EXISTS daily_results_quiz_score_idx 
  ON public.daily_results (quiz_id, score DESC, total_time_ms ASC, completed_at ASC, player_id ASC);
CREATE INDEX IF NOT EXISTS daily_results_player_idx 
  ON public.daily_results (player_id, completed_at DESC);

-- Outbox events indexes
CREATE INDEX IF NOT EXISTS outbox_events_occurred_at_idx 
  ON public.outbox_events (occurred_at);
CREATE INDEX IF NOT EXISTS outbox_events_agg_idx 
  ON public.outbox_events (aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS outbox_events_type_idx 
  ON public.outbox_events (event_type);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Quiz play view (public, no correct answers)
CREATE OR REPLACE VIEW public.quiz_play_view AS
SELECT 
  q.id AS question_id,
  q.quiz_id,
  q.prompt,
  q.order_index,
  qc.id AS choice_id,
  qc.text AS choice_text,
  qc.order_index AS choice_order,
  array_agg(DISTINCT qt.tag) FILTER (WHERE qt.tag IS NOT NULL) AS tags
FROM public.questions q
LEFT JOIN public.question_choices qc ON q.id = qc.question_id
LEFT JOIN public.question_tags qt ON q.id = qt.question_id
GROUP BY q.id, q.quiz_id, q.prompt, q.order_index, qc.id, qc.text, qc.order_index
ORDER BY q.order_index, qc.order_index;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.correct_answers ENABLE ROW LEVEL SECURITY;

-- Private correct answers: DENY ALL for authenticated users (service role only)
CREATE POLICY "deny_all_correct_answers" ON private.correct_answers
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Profiles: users can read their own, public read of handles
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_read_public" ON public.profiles
  FOR SELECT
  USING (true); -- Public read of handle_display, handle_canonical

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

-- Daily results: users can read their own only
CREATE POLICY "daily_results_read_own" ON public.daily_results
  FOR SELECT
  USING (auth.uid() = player_id);

-- Quiz play view: RLS is inherited from underlying tables (questions, question_choices)
-- No separate policy needed - view uses policies from questions and question_choices tables

-- Quizzes: public read of published quizzes
CREATE POLICY "quizzes_read_published" ON public.quizzes
  FOR SELECT
  USING (status = 'published');

-- Questions: public read (via quiz_play_view, but allow direct read too)
CREATE POLICY "questions_read_public" ON public.questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quizzes q 
      WHERE q.id = questions.quiz_id 
      AND q.status = 'published'
    )
  );

-- Question choices: public read
CREATE POLICY "question_choices_read_public" ON public.question_choices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questions q 
      WHERE q.id = question_choices.question_id
      AND EXISTS (
        SELECT 1 FROM public.quizzes qz 
        WHERE qz.id = q.quiz_id 
        AND qz.status = 'published'
      )
    )
  );

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
-- TRIGGERS
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

CREATE TRIGGER attempts_enforce_timing
  BEFORE INSERT OR UPDATE ON public.attempts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_question_timing();

