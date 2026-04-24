import { edgeFunctions } from '@/lib/api/edge-functions';

export interface Profile {
  player_id: string;
  handle_display: string;
  handle_canonical: string;
  created_at: string;
  stats: {
    all_time_best: number | null;
    all_time_worst: number | null;
    total_games: number;
    average_score: number | null;
    perfect_games: number;
    overall_accuracy: number | null;
    avg_time_per_question_ms: number | null;
  };
  streaks: {
    current_streak: number;
    longest_streak: number;
  };
  recent_results: Array<{
    score: number;
    correct_count: number;
    completed_at: string;
  }>;
  category_performance: Array<{
    category: string;
    total_questions: number;
    correct_count: number;
    accuracy: number;
    average_score: number;
    best_score: number;
  }>;
}

export async function getProfileByHandle(handle: string): Promise<Profile> {
  const response = await edgeFunctions.getProfileByHandle(handle);
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to load profile');
  }
  return response.data;
}

export async function updateHandle(handle: string) {
  const response = await edgeFunctions.updateHandle(handle);
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to update handle');
  }
  return response.data;
}
