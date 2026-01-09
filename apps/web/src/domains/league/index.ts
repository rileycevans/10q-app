/**
 * League domain adapter
 * Provides typed interfaces for league operations
 */

import { edgeFunctions } from '@/lib/api/edge-functions';

export interface League {
  league_id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: 'owner' | 'member';
  member_count: number;
  is_owner: boolean;
}

export interface LeagueDetails {
  league_id: string;
  name: string;
  owner_id: string;
  created_at: string;
  is_owner: boolean;
  members: Array<{
    player_id: string;
    handle_display: string;
    role: 'owner' | 'member';
    created_at: string;
  }>;
}

export interface LeagueMember {
  player_id: string;
  handle_display: string;
  role: 'owner' | 'member';
  created_at: string;
}

/**
 * Create a new league
 */
export async function createLeague(name: string): Promise<{
  league_id: string;
  name: string;
  owner_id: string;
  created_at: string;
}> {
  const response = await edgeFunctions.createLeague(name);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to create league');
  }

  return response.data;
}

/**
 * Get all leagues the current user is a member of
 */
export async function getMyLeagues(): Promise<League[]> {
  const response = await edgeFunctions.getMyLeagues();

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch leagues');
  }

  return response.data.leagues;
}

/**
 * Get detailed information about a league
 */
export async function getLeagueDetails(leagueId: string): Promise<LeagueDetails> {
  const response = await edgeFunctions.getLeagueDetails(leagueId);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch league details');
  }

  return response.data;
}

/**
 * Add a member to a league by handle
 */
export async function addLeagueMember(
  leagueId: string,
  handle: string
): Promise<LeagueMember> {
  const response = await edgeFunctions.addLeagueMember(leagueId, handle);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to add member');
  }

  return {
    player_id: response.data.player_id,
    handle_display: response.data.handle_display,
    role: response.data.role,
    created_at: new Date().toISOString(),
  };
}

/**
 * Remove a member from a league
 */
export async function removeLeagueMember(
  leagueId: string,
  playerId: string
): Promise<void> {
  const response = await edgeFunctions.removeLeagueMember(leagueId, playerId);

  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to remove member');
  }
}

/**
 * Delete a league
 */
export async function deleteLeague(leagueId: string): Promise<void> {
  const response = await edgeFunctions.deleteLeague(leagueId);

  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to delete league');
  }
}

