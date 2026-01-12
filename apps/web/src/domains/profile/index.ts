/**
 * Profile domain adapter
 * Provides typed interfaces for profile operations
 */

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

export interface HandleUpdate {
  handle_display: string;
  handle_canonical: string;
  handle_last_changed_at: string;
}

/**
 * Get profile by handle (public)
 */
export async function getProfileByHandle(handle: string): Promise<Profile> {
  const response = await edgeFunctions.getProfileByHandle(handle);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch profile');
  }

  return response.data;
}

/**
 * Update user's handle
 */
export async function updateHandle(newHandle: string): Promise<HandleUpdate> {
  const response = await edgeFunctions.updateHandle(newHandle);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to update handle');
  }

  return response.data;
}

