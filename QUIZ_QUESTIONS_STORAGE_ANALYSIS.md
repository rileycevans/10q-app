# Quiz Questions Storage & Fetching - Plan vs Implementation

## Executive Summary

**TL;DR**: The current implementation is **simpler and more direct** than the Notion plan, which is appropriate for MVP. Questions are stored in PostgreSQL tables, fetched via a database view (`quiz_play_view`), and served through Edge Functions. The main differences from the plan are:
- Questions are quiz-specific (direct FK, not junction table)
- Tags are simple TEXT fields (not normalized)
- Field names differ (`prompt` vs `body`, `text` vs `body`)

**Current Flow:**
1. Client calls `get-current-quiz` → gets `quiz_id`
2. Client calls `start-attempt` → Edge Function queries `quiz_play_view`
3. `quiz_play_view` joins `questions` → `question_choices` → `question_tags`
4. Returns structured question data with choices and tags

## Overview

This document compares the original Notion plan for quiz question storage and fetching with the current implementation.

## Notion Plan Summary

Based on the Notion specs (Backend & Data Model V1, Admin/Content Authoring V1):

### Planned Data Model

1. **Questions Table**
   - `id` UUID PK
   - `body` TEXT NOT NULL (question text)
   - `created_at` TIMESTAMPTZ

2. **Question Answers Table**
   - `id` UUID PK
   - `question_id` UUID FK → `questions(id)`
   - `body` TEXT NOT NULL (answer text)
   - `sort_index` INT (0-3)
   - `is_correct` BOOLEAN NOT NULL
   - Rules: exactly 4 answers per question, exactly 1 correct

3. **Tags System**
   - `tags` table with `id`, `name`, `slug`
   - `question_tags` junction table with `question_id` and `tag_id`
   - Each question must have 1-5 tags

4. **Quiz Questions Junction**
   - `quiz_questions` table linking quizzes to questions
   - `quiz_id` UUID FK
   - `question_id` UUID FK
   - `order_index` INT (1-10)
   - Constraints: PRIMARY KEY (`quiz_id`, `question_id`), UNIQUE (`quiz_id`, `order_index`)

### Planned Fetching Strategy

- Questions fetched via Edge Functions
- Server-authoritative timing and scoring
- Results derived from DB joins (no snapshot table in MVP)
- Questions linked to quizzes via `quiz_questions` junction table

## Current Implementation

### Actual Data Model

1. **Questions Table** ✅ (Similar, but different field names)
   ```sql
   CREATE TABLE questions (
     id UUID PRIMARY KEY,
     quiz_id UUID NOT NULL REFERENCES quizzes(id),  -- Direct FK, not junction!
     prompt TEXT NOT NULL,  -- Called "prompt" not "body"
     order_index INT NOT NULL CHECK (order_index BETWEEN 1 AND 10),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE(quiz_id, order_index)
   );
   ```

2. **Question Choices Table** ✅ (Similar structure, different names)
   ```sql
   CREATE TABLE question_choices (
     id UUID PRIMARY KEY,
     question_id UUID NOT NULL REFERENCES questions(id),
     text TEXT NOT NULL,  -- Called "text" not "body"
     order_index INT NOT NULL CHECK (order_index BETWEEN 1 AND 4),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE(question_id, order_index)
   );
   ```

3. **Correct Answers** ✅ (Private schema, as planned)
   ```sql
   CREATE TABLE private.correct_answers (
     question_id UUID PRIMARY KEY REFERENCES questions(id),
     correct_choice_id UUID NOT NULL REFERENCES question_choices(id),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```

4. **Tags System** ⚠️ (Simplified - no separate tags table)
   ```sql
   CREATE TABLE question_tags (
     question_id UUID NOT NULL REFERENCES questions(id),
     tag TEXT NOT NULL,  -- Direct TEXT, not FK to tags table
     PRIMARY KEY (question_id, tag)
   );
   ```

### Key Differences from Plan

#### ✅ What Matches

1. **Core Structure**: Questions, choices, correct answers all exist
2. **Validation Rules**: 4 choices per question, 1 correct answer
3. **Private Correct Answers**: Stored in `private` schema as planned
4. **Server-Authoritative**: Timing and scoring handled server-side
5. **Tag Requirements**: 1-5 tags per question (enforced in validation)

#### ⚠️ What's Different

1. **No Junction Table**: Questions directly reference `quiz_id` instead of using `quiz_questions` junction table
   - **Plan**: `questions` → `quiz_questions` → `quizzes`
   - **Actual**: `questions` → `quizzes` (direct FK)

2. **Simplified Tags**: No separate `tags` table with `id`, `name`, `slug`
   - **Plan**: `tags` table + `question_tags` junction
   - **Actual**: `question_tags` with direct TEXT tags

3. **Field Names**: 
   - `body` → `prompt` (questions)
   - `body` → `text` (choices)
   - `sort_index` → `order_index` (choices)

4. **Question Structure**: Questions are quiz-specific (have `quiz_id`), not reusable across quizzes
   - **Plan**: Questions could be reused via junction table
   - **Actual**: Each question belongs to one quiz

## Fetching Strategy

### How Questions Are Currently Fetched

1. **Get Current Quiz** (`get-current-quiz` Edge Function)
   - Returns `quiz_id` of current published quiz
   - Query: `SELECT * FROM quizzes WHERE status = 'published' AND release_at_utc <= now() ORDER BY release_at_utc DESC LIMIT 1`

2. **Start/Resume Attempt** (`start-attempt` / `resume-attempt` Edge Functions)
   - Uses `quiz_play_view` (database view) to fetch questions
   - Returns current question with choices and tags
   - Query: `SELECT * FROM quiz_play_view WHERE quiz_id = ? AND order_index = ?`

3. **Quiz Play View** (Database View) - The Key Fetching Mechanism
   ```sql
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
   ```

   **Key Features:**
   - Joins questions → choices → tags in one view
   - Aggregates tags into an array per question
   - Returns one row per question-choice combination (so 4 rows per question)
   - Client-side code groups by question_id to reconstruct full question objects

4. **Client-Side Fetching** (from `apps/web/src/domains/quiz/index.ts`)
   - Client calls Edge Functions, not direct database queries
   - Edge Functions query `quiz_play_view` and return structured data
   - Client receives questions with choices and tags pre-joined

### Current Implementation Details

- Questions fetched via Edge Functions ✅
- Server-authoritative timing ✅
- Results derived from joins ✅
- Questions linked directly to quizzes (not via junction) ⚠️

## Implications

### Advantages of Current Approach

1. **Simpler Queries**: Direct FK makes it easier to fetch quiz questions
2. **No Reusability Needed**: MVP doesn't require question reuse across quizzes
3. **Simpler Tags**: Direct TEXT tags are sufficient for MVP

### Potential Issues

1. **Question Reusability**: Can't easily reuse questions across multiple quizzes (but MVP doesn't need this)
2. **Tag Management**: No centralized tag management (can't easily rename/merge tags)
3. **Schema Mismatch**: If you want to align with the Notion plan later, would need migration

## Recommendations

### For MVP (Current State)
✅ **Keep as-is** - The current implementation works well for MVP:
- Simpler queries
- Direct relationships
- No unnecessary complexity

### For Future (If Needed)
If you need to align with the Notion plan:

1. **Add Junction Table** (if question reuse needed):
   ```sql
   CREATE TABLE quiz_questions (
     quiz_id UUID REFERENCES quizzes(id),
     question_id UUID REFERENCES questions(id),
     order_index INT,
     PRIMARY KEY (quiz_id, question_id),
     UNIQUE (quiz_id, order_index)
   );
   ```
   Then remove `quiz_id` from `questions` table.

2. **Add Tags Table** (if tag management needed):
   ```sql
   CREATE TABLE tags (
     id UUID PRIMARY KEY,
     name TEXT NOT NULL,
     slug TEXT UNIQUE NOT NULL
   );
   ```
   Then update `question_tags` to use `tag_id` FK instead of TEXT.

## Conclusion

The current implementation is **simpler and more direct** than the Notion plan, which is appropriate for MVP. The main differences are:

1. Questions are quiz-specific (not reusable) - **Fine for MVP**
2. Tags are simple TEXT fields (not normalized) - **Fine for MVP**
3. No junction table needed - **Simpler for MVP**

The core functionality matches: questions stored in database, fetched via Edge Functions, server-authoritative scoring. The implementation is production-ready for MVP needs.
