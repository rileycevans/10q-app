# Implementation Plan: Align with Notion Documentation

## Goal

Migrate the database schema and codebase to match the **Notion Backend & Data Model (V1)** specification exactly, then create a single test quiz for development.

---

## Phase 1: Database Schema Migration

### 1.1 Schema Differences (Current vs Notion Plan)

| Aspect | Current Implementation | Notion Plan | Action |
|--------|----------------------|-------------|--------|
| **Questions table** | `quiz_id` FK, `prompt` field | No `quiz_id`, `body` field | Remove FK, rename field |
| **Answers table** | `question_choices` with `text` | `question_answers` with `body`, `is_correct` | Rename table + fields, add `is_correct` |
| **Correct answers** | `private.correct_answers` table | `is_correct` boolean on `question_answers` | Merge into answers table |
| **Tags** | `question_tags` with TEXT `tag` | `tags` table + `question_tags` with `tag_id` FK | Add `tags` table, change FK |
| **Quiz-Question link** | Direct FK on `questions` | `quiz_questions` junction table | Add junction table |
| **Sort index** | `order_index` (1-4) | `sort_index` (0-3) | Change range |
| **Players table** | `profiles` (keyed by auth.users.id) | `players` with `linked_auth_user_id` | Consider renaming or aliasing |

### 1.2 New Migration File

Create: `supabase/migrations/20250119000000_notion_schema_alignment.sql`

```sql
-- ============================================================================
-- PHASE 1: Add new tables (Notion Plan structure)
-- ============================================================================

-- Tags table (normalized)
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quiz-Questions junction table
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_id UUID NOT NULL, -- Will reference new questions table
  order_index INT NOT NULL CHECK (order_index BETWEEN 1 AND 10),
  PRIMARY KEY (quiz_id, question_id),
  UNIQUE (quiz_id, order_index)
);

-- ============================================================================
-- PHASE 2: Create new questions table (Notion structure)
-- ============================================================================

-- New questions table (no quiz_id, uses body instead of prompt)
CREATE TABLE IF NOT EXISTS public.questions_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- New question_answers table (with is_correct, uses body instead of text)
CREATE TABLE IF NOT EXISTS public.question_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.questions_new(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  sort_index INT NOT NULL CHECK (sort_index BETWEEN 0 AND 3),
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, sort_index)
);

-- New question_tags junction (with tag_id FK)
CREATE TABLE IF NOT EXISTS public.question_tags_new (
  question_id UUID NOT NULL REFERENCES public.questions_new(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

-- ============================================================================
-- PHASE 3: Update foreign keys to new structure
-- ============================================================================

-- Update quiz_questions to reference new questions table
ALTER TABLE public.quiz_questions 
  ADD CONSTRAINT quiz_questions_question_id_fkey 
  FOREIGN KEY (question_id) REFERENCES public.questions_new(id) ON DELETE CASCADE;

-- Update attempt_answers to reference new tables
ALTER TABLE public.attempt_answers 
  DROP CONSTRAINT IF EXISTS attempt_answers_question_id_fkey,
  DROP CONSTRAINT IF EXISTS attempt_answers_selected_answer_id_fkey;

-- Rename selected_answer_id to selected_answer_id (references question_answers)
-- This will be done after data migration

-- ============================================================================
-- PHASE 4: Data migration (if needed)
-- ============================================================================

-- For a fresh start, we can skip data migration and just drop old tables
-- For production, would need careful data migration here

-- ============================================================================
-- PHASE 5: Cleanup old tables (after verification)
-- ============================================================================

-- DROP TABLE IF EXISTS private.correct_answers CASCADE;
-- DROP TABLE IF EXISTS public.question_tags CASCADE;
-- DROP TABLE IF EXISTS public.question_choices CASCADE;
-- DROP TABLE IF EXISTS public.questions CASCADE;

-- Rename new tables to final names
-- ALTER TABLE public.questions_new RENAME TO questions;
-- ALTER TABLE public.question_tags_new RENAME TO question_tags;

-- ============================================================================
-- PHASE 6: Update views
-- ============================================================================

-- New quiz_play_view using Notion structure
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
FROM public.questions_new q
JOIN public.quiz_questions qq ON q.id = qq.question_id
LEFT JOIN public.question_answers qa ON q.id = qa.question_id
LEFT JOIN public.question_tags_new qt ON q.id = qt.question_id
LEFT JOIN public.tags t ON qt.tag_id = t.id
GROUP BY q.id, qq.quiz_id, q.body, qq.order_index, qa.id, qa.body, qa.sort_index
ORDER BY qq.order_index, qa.sort_index;

-- ============================================================================
-- PHASE 7: RLS Policies
-- ============================================================================

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_tags_new ENABLE ROW LEVEL SECURITY;

-- Tags: public read
CREATE POLICY "tags_read_public" ON public.tags
  FOR SELECT USING (true);

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
CREATE POLICY "questions_new_read_published" ON public.questions_new
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quiz_questions qq
      JOIN public.quizzes qz ON qz.id = qq.quiz_id
      WHERE qq.question_id = questions_new.id
      AND qz.status = 'published'
    )
  );

-- Question answers: public read (but is_correct should be hidden!)
-- IMPORTANT: Need view or function to hide is_correct from clients
CREATE POLICY "question_answers_read_published" ON public.question_answers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questions_new q
      JOIN public.quiz_questions qq ON qq.question_id = q.id
      JOIN public.quizzes qz ON qz.id = qq.quiz_id
      WHERE q.id = question_answers.question_id
      AND qz.status = 'published'
    )
  );

-- Question tags: public read
CREATE POLICY "question_tags_new_read_published" ON public.question_tags_new
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.questions_new q
      JOIN public.quiz_questions qq ON qq.question_id = q.id
      JOIN public.quizzes qz ON qz.id = qq.quiz_id
      WHERE q.id = question_tags_new.question_id
      AND qz.status = 'published'
    )
  );
```

---

## Phase 2: Edge Function Updates

### 2.1 Functions That Need Updates

| Edge Function | Changes Required |
|---------------|------------------|
| `get-current-quiz` | No change (queries `quizzes` table) |
| `start-attempt` | Update to query via `quiz_questions` junction |
| `resume-attempt` | Update to query via `quiz_questions` junction |
| `submit-answer` | Update to check `is_correct` on `question_answers` |
| `get-attempt-results` | Update field names (`body` instead of `prompt`/`text`) |
| `publish-quiz` | Update validation to use new structure |
| `finalize-attempt` | Minor FK reference updates |

### 2.2 Key Query Changes

**Before (current):**
```typescript
// Getting question for quiz
const { data } = await supabase
  .from("questions")
  .select("id, prompt, order_index")
  .eq("quiz_id", quizId);
```

**After (Notion plan):**
```typescript
// Getting question for quiz via junction table
const { data } = await supabase
  .from("quiz_questions")
  .select(`
    order_index,
    questions_new (
      id,
      body,
      question_answers (id, body, sort_index),
      question_tags_new (tags (id, name, slug))
    )
  `)
  .eq("quiz_id", quizId);
```

**Checking correct answer:**
```typescript
// Before: Query private.correct_answers
const { data: correct } = await supabase
  .from("correct_answers")
  .select("correct_choice_id")
  .eq("question_id", questionId);

// After: Check is_correct on question_answers (service role only!)
const { data: answer } = await supabase
  .from("question_answers")
  .select("is_correct")
  .eq("id", selectedAnswerId)
  .single();
```

---

## Phase 3: Create Test Quiz Script

### 3.1 New Script: `scripts/create-test-quiz-notion.ts`

```typescript
/**
 * Create Test Quiz (Notion Plan Structure)
 * Creates a quiz following the exact Notion data model
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface TestQuestion {
  body: string;
  answers: Array<{ body: string; is_correct: boolean }>;
  tags: string[];
}

const TEST_QUESTIONS: TestQuestion[] = [
  {
    body: 'What is the capital of France?',
    answers: [
      { body: 'Paris', is_correct: true },
      { body: 'London', is_correct: false },
      { body: 'Berlin', is_correct: false },
      { body: 'Madrid', is_correct: false },
    ],
    tags: ['Geography', 'Europe'],
  },
  // ... 9 more questions
];

async function createTestQuiz() {
  // 1. Create tags (if not exist)
  for (const q of TEST_QUESTIONS) {
    for (const tagName of q.tags) {
      const slug = tagName.toLowerCase().replace(/\s+/g, '-');
      await supabase
        .from('tags')
        .upsert({ name: tagName, slug }, { onConflict: 'slug' });
    }
  }

  // 2. Create quiz
  const { data: quiz } = await supabase
    .from('quizzes')
    .insert({
      release_at_utc: new Date().toISOString(),
      status: 'draft',
    })
    .select('id')
    .single();

  // 3. Create questions
  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const testQ = TEST_QUESTIONS[i];

    // Create question
    const { data: question } = await supabase
      .from('questions_new')
      .insert({ body: testQ.body })
      .select('id')
      .single();

    // Create answers (with sort_index 0-3)
    for (let j = 0; j < testQ.answers.length; j++) {
      await supabase
        .from('question_answers')
        .insert({
          question_id: question.id,
          body: testQ.answers[j].body,
          sort_index: j,  // 0-3 per Notion plan
          is_correct: testQ.answers[j].is_correct,
        });
    }

    // Link tags
    for (const tagName of testQ.tags) {
      const slug = tagName.toLowerCase().replace(/\s+/g, '-');
      const { data: tag } = await supabase
        .from('tags')
        .select('id')
        .eq('slug', slug)
        .single();

      await supabase
        .from('question_tags_new')
        .insert({
          question_id: question.id,
          tag_id: tag.id,
        });
    }

    // Link question to quiz
    await supabase
      .from('quiz_questions')
      .insert({
        quiz_id: quiz.id,
        question_id: question.id,
        order_index: i + 1,  // 1-10 per Notion plan
      });
  }

  // 4. Publish quiz
  await supabase
    .from('quizzes')
    .update({ status: 'published' })
    .eq('id', quiz.id);

  console.log(`Quiz created and published: ${quiz.id}`);
}
```

---

## Phase 4: Client Code Updates

### 4.1 Field Name Changes

| Current | Notion Plan | Files Affected |
|---------|-------------|----------------|
| `prompt` | `body` | Question display components |
| `text` | `body` | Answer button components |
| `order_index` (choices) | `sort_index` | Answer ordering |
| `question_choices` | `question_answers` | All API calls |

### 4.2 Domain Layer Updates

Update `apps/web/src/domains/quiz/index.ts` to use new field names and query structure.

---

## Phase 5: View Updates (Hiding is_correct)

### 5.1 Security Concern

The Notion plan has `is_correct` on `question_answers`, but this **MUST NOT** be visible to clients during gameplay.

**Solution Options:**

1. **View that excludes is_correct:**
```sql
CREATE VIEW public.question_answers_public AS
SELECT id, question_id, body, sort_index, created_at
FROM public.question_answers;
-- (hide is_correct)
```

2. **RLS policy that denies is_correct column:** Not possible in PostgreSQL

3. **Edge Function always queries, never exposes:** Current approach (recommended)

**Recommendation:** Keep the `is_correct` check in Edge Functions only (service role), never expose to client.

---

## Implementation Order

### Step 1: Create New Migration File
- Add new tables (`tags`, `quiz_questions`, `questions_new`, `question_answers`, `question_tags_new`)
- Add RLS policies
- Create updated view

### Step 2: Update Edge Functions
- Update `start-attempt` to use junction table
- Update `resume-attempt` to use junction table
- Update `submit-answer` to check `is_correct` on `question_answers`
- Update `get-attempt-results` to use new field names
- Update `publish-quiz` validation

### Step 3: Create Test Quiz Script
- New script following Notion structure
- Create tags, questions, answers, quiz_questions links

### Step 4: Update Client Code
- Update field names in components
- Update domain layer queries

### Step 5: Test End-to-End
- Run test quiz script
- Test full gameplay flow
- Verify leaderboards still work

### Step 6: Cleanup (Optional)
- Drop old tables after verification
- Rename `_new` tables to final names

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing data | Fresh start for dev - no data migration needed |
| `is_correct` exposure | Keep checks in Edge Functions only (service role) |
| Complex migration | Phased approach with parallel tables |
| Edge Function downtime | Update all functions before switching |

---

## Estimated Effort

| Phase | Estimated Time |
|-------|---------------|
| Phase 1: Database Migration | 2-3 hours |
| Phase 2: Edge Function Updates | 3-4 hours |
| Phase 3: Test Quiz Script | 1 hour |
| Phase 4: Client Code Updates | 2-3 hours |
| Phase 5: Testing | 2-3 hours |
| **Total** | **10-14 hours** |

---

## Decision Points

Before proceeding, confirm:

1. **Fresh start vs migration?** For dev, fresh start is simpler. Drop existing quiz data?

2. **Table naming?** Use `questions_new` temporarily, or rename existing?

3. **Players vs Profiles?** Notion says `players`, current code uses `profiles`. Rename or alias?

4. **is_correct security?** Keep Edge Function approach (recommended) or create view?

---

## Next Steps

1. Review this plan
2. Confirm decision points
3. I'll implement Phase 1 (Database Migration) first
4. Then proceed phase by phase

Ready to proceed when you are!
