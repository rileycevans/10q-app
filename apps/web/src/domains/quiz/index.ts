/**
 * Quiz Domain Layer
 * Follows Notion Backend & Data Model (V1) specification
 */

import { edgeFunctions } from '@/lib/api/edge-functions';
import { supabase } from '@/lib/supabase/client';

// Types following Notion plan
export interface QuizAnswer {
  answer_id: string;
  body: string; // Notion plan: body instead of text
  sort_index: number; // Notion plan: sort_index 0-3
}

export interface QuizQuestion {
  question_id: string;
  quiz_id: string;
  body: string; // Notion plan: body instead of prompt
  order_index: number;
  answers: QuizAnswer[]; // Notion plan: answers instead of choices
  tags: string[];
}

export interface CurrentQuiz {
  quiz_id: string;
  release_at_utc: string;
}

/**
 * Get the current published quiz
 */
export async function getCurrentQuiz(): Promise<CurrentQuiz | null> {
  const response = await edgeFunctions.getCurrentQuiz();
  
  if (!response.ok || !response.data) {
    return null;
  }
  
  return response.data;
}

/**
 * Get all questions for a quiz
 * Uses quiz_play_view which joins via quiz_questions junction
 */
export async function getQuizQuestions(quizId: string): Promise<QuizQuestion[]> {
  const { data, error } = await supabase
    .from('quiz_play_view')
    .select('*')
    .eq('quiz_id', quizId);

  if (error || !data) {
    console.error('Failed to fetch quiz questions:', error);
    return [];
  }

  // Group rows by question_id (view returns one row per answer)
  const questionMap = new Map<string, QuizQuestion>();
  
  for (const row of data) {
    if (!questionMap.has(row.question_id)) {
      questionMap.set(row.question_id, {
        question_id: row.question_id,
        quiz_id: row.quiz_id,
        body: row.body,
        order_index: row.order_index,
        answers: [],
        tags: row.tags || [],
      });
    }
    
    const question = questionMap.get(row.question_id)!;
    
    // Add answer if present and not already added
    if (row.answer_id && !question.answers.some(a => a.answer_id === row.answer_id)) {
      question.answers.push({
        answer_id: row.answer_id,
        body: row.answer_body,
        sort_index: row.answer_sort_index,
      });
    }
  }
  
  // Sort questions by order_index and answers by sort_index
  const questions = Array.from(questionMap.values())
    .sort((a, b) => a.order_index - b.order_index);
  
  for (const question of questions) {
    question.answers.sort((a, b) => a.sort_index - b.sort_index);
  }
  
  return questions;
}
