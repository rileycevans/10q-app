import { supabase } from '@/lib/supabase/client';
import { edgeFunctions } from '@/lib/api/edge-functions';

export interface QuizQuestion {
  question_id: string;
  prompt: string;
  order_index: number;
  choices: {
    choice_id: string;
    text: string;
    order_index: number;
  }[];
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
 * Get all questions for a quiz from quiz_play_view
 */
export async function getQuizQuestions(quizId: string): Promise<QuizQuestion[]> {
  const { data, error } = await supabase
    .from('quiz_play_view')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })
    .order('choice_order', { ascending: true });

  if (error || !data) {
    throw new Error('Failed to fetch quiz questions');
  }

  // Group by question
  const questionsMap = new Map<string, QuizQuestion>();

  for (const row of data) {
    const questionId = row.question_id;
    
    if (!questionsMap.has(questionId)) {
      questionsMap.set(questionId, {
        question_id: questionId,
        prompt: row.prompt,
        order_index: row.order_index,
        choices: [],
        tags: Array.isArray(row.tags) ? row.tags : [],
      });
    }

    const question = questionsMap.get(questionId)!;
    question.choices.push({
      choice_id: row.choice_id,
      text: row.choice_text,
      order_index: row.choice_order,
    });
  }

  return Array.from(questionsMap.values()).sort((a, b) => a.order_index - b.order_index);
}

