'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  getLeagueDetails,
  addLeagueMember,
  removeLeagueMember,
  deleteLeague,
  type LeagueDetails,
} from '@/domains/league';
import {
  getLeagueLeaderboard,
  type LeaderboardWindow,
  type LeaderboardMode,
  type ScoreType,
  type LeagueLeaderboardResponse,
} from '@/domains/leaderboard';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { LeaderboardTable } from '@/components/LeaderboardTable';
import { LeagueMemberList } from '@/components/LeagueMemberList';
import { AddMemberForm } from '@/components/AddMemberForm';
import { getSession } from '@/lib/auth';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function LeagueDetailPage() {
  const router = useRouter();
  const params = useParams();
  const leagueId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leagueDetails, setLeagueDetails] = useState<LeagueDetails | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<LeagueLeaderboardResponse | null>(null);
  const [window, setWindow] = useState<LeaderboardWindow>('7d');
  const [scoreType, setScoreType] = useState<ScoreType>('cumulative');
  const [mode, setMode] = useState<LeaderboardMode>('top');
  const [userPlayerId, setUserPlayerId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      if (!mounted) return;

      try {
        setLoading(true);
        setError(null);

        const session = await getSession();
        if (!session) {
          setError('Please sign in to view league details');
          setLoading(false);
          return;
        }

        setUserPlayerId(session.user.id);

        // Fetch league details
        const details = await getLeagueDetails(leagueId);
        if (!mounted) return;
        setLeagueDetails(details);

        // Fetch leaderboard
        const leaderboard = await getLeagueLeaderboard({
          league_id: leagueId,
          window,
          mode,
          limit: mode === 'top' ? 100 : undefined,
          count: mode === 'around' ? 12 : undefined,
          score_type: scoreType,
        });
        if (mounted) {
          setLeaderboardData(leaderboard);
        }
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load league';
        setError(errorMessage);
        console.error('League detail page error:', err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      mounted = false;
    };
  }, [leagueId, window, scoreType, mode]);

  async function handleAddMember(handle: string) {
    if (!leagueDetails) return;
    await addLeagueMember(leagueId, handle);
    // Refresh league details
    const details = await getLeagueDetails(leagueId);
    setLeagueDetails(details);
  }

  async function handleRemoveMember(playerId: string) {
    if (!leagueDetails) return;
    await removeLeagueMember(leagueId, playerId);
    // Refresh league details
    const details = await getLeagueDetails(leagueId);
    setLeagueDetails(details);
  }

  async function handleDeleteLeague() {
    if (!leagueDetails || !showDeleteConfirm) return;

    setDeleting(true);
    try {
      await deleteLeague(leagueId);
      router.push('/leagues');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete league');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading League...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (error) {
    const isAuthError = error.includes('sign in') || error.includes('Sign In');
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="absolute top-4 left-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">
              {isAuthError ? 'Sign In Required' : 'Error Loading League'}
            </h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            {isAuthError && (
              <div className="mb-6">
                <p className="font-body text-sm mb-4 text-ink/80">
                  Click the "Sign In" button in the top-right corner, then refresh this page.
                </p>
              </div>
            )}
            <button
              onClick={() => router.push('/leagues')}
              className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              Back to Leagues
            </button>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (!leagueDetails) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">League not found</p>
            <button
              onClick={() => router.push('/leagues')}
              className="mt-4 h-12 w-full bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink"
            >
              Back to Leagues
            </button>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>

        {/* League Header */}
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6 text-center">
          <h1 className="font-display text-3xl mb-2 text-ink">{leagueDetails.name}</h1>
          <p className="font-body text-sm text-ink/80 mb-4">
            Created {new Date(leagueDetails.created_at).toLocaleDateString()}
          </p>
          {leagueDetails.is_owner && (
            <span className="inline-block px-3 py-1 bg-yellow border-[3px] border-ink rounded-full font-bold text-xs text-ink">
              YOU ARE OWNER
            </span>
          )}
        </div>

        {/* Members Section */}
        <div className="w-full max-w-2xl mb-6">
          <LeagueMemberList
            members={leagueDetails.members}
            isOwner={leagueDetails.is_owner}
            onRemove={leagueDetails.is_owner ? handleRemoveMember : undefined}
            currentUserId={userPlayerId}
          />
        </div>

        {/* Add Member Form (Owner Only) */}
        {leagueDetails.is_owner && (
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6">
            <h2 className="font-display text-xl font-bold text-ink mb-4">Add Member</h2>
            <AddMemberForm onAdd={handleAddMember} />
          </div>
        )}

        {/* Leaderboard Controls */}
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6">
          <h2 className="font-display text-2xl mb-4 text-ink text-center">League Leaderboard</h2>

          {/* Controls */}
          <div className="space-y-4">
            {/* Window Selector */}
            <div>
              <label className="block font-bold text-sm uppercase tracking-wide text-ink mb-2">
                Time Window
              </label>
              <div className="flex gap-2 flex-wrap justify-center">
                {(['today', '7d', '30d', '365d'] as LeaderboardWindow[]).map((w) => (
                  <button
                    key={w}
                    onClick={() => setWindow(w)}
                    className={`h-10 px-4 border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] ${
                      window === w
                        ? 'bg-cyanA text-ink'
                        : 'bg-paper text-ink hover:bg-cyanA/20'
                    }`}
                  >
                    {w === 'today' ? 'Today' : w === '7d' ? 'Week' : w === '30d' ? 'Month' : 'Year'}
                  </button>
                ))}
              </div>
            </div>

            {/* Score Type Toggle */}
            <div>
              <label className="block font-bold text-sm uppercase tracking-wide text-ink mb-2">
                Score Type
              </label>
              <div className="flex gap-2 justify-center">
                {(['cumulative', 'average'] as ScoreType[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setScoreType(st)}
                    className={`h-10 px-6 border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] ${
                      scoreType === st
                        ? 'bg-green text-ink'
                        : 'bg-paper text-ink hover:bg-green/20'
                    }`}
                  >
                    {st === 'cumulative' ? 'Cumulative' : 'Average'}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode Toggle */}
            <div>
              <label className="block font-bold text-sm uppercase tracking-wide text-ink mb-2">
                View Mode
              </label>
              <div className="flex gap-2 justify-center">
                {(['top', 'around'] as LeaderboardMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`h-10 px-6 border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] ${
                      mode === m
                        ? 'bg-yellow text-ink'
                        : 'bg-paper text-ink hover:bg-yellow/20'
                    }`}
                  >
                    {m === 'top' ? 'Top Players' : 'Around Me'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* User Rank Summary */}
        {leaderboardData && leaderboardData.user_rank && (
          <div className="bg-cyanA border-[4px] border-ink rounded-[24px] shadow-sticker p-4 w-full max-w-2xl mb-6 text-center">
            <p className="font-display text-2xl font-bold text-ink">
              Your Rank: #{leaderboardData.user_rank} of {leaderboardData.total_players}
            </p>
            {leaderboardData.user_entry && (
              <p className="font-body text-sm text-ink/80 mt-2">
                {scoreType === 'cumulative' ? 'Total' : 'Average'} Score:{' '}
                {leaderboardData.user_entry.aggregated_score.toFixed(1)} •{' '}
                {leaderboardData.user_entry.attempt_count} games
              </p>
            )}
          </div>
        )}

        {/* Leaderboard Table */}
        {leaderboardData && (
          <div className="w-full max-w-2xl mb-6">
            <LeaderboardTable
              entries={leaderboardData.entries}
              userRank={leaderboardData.user_rank}
              userPlayerId={userPlayerId}
              scoreType={scoreType}
            />
          </div>
        )}

        {/* Delete League (Owner Only) */}
        {leagueDetails.is_owner && (
          <div className="bg-red border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6">
            <h3 className="font-display text-xl font-bold text-ink mb-4">Danger Zone</h3>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="h-12 px-6 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
              >
                Delete League
              </button>
            ) : (
              <div className="space-y-3">
                <p className="font-body font-bold text-sm text-ink">
                  Are you sure? This will permanently delete the league and all member data.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                    className="flex-1 h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteLeague}
                    disabled={deleting}
                    className="flex-1 h-12 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Back Button */}
        <button
          onClick={() => router.push('/leagues')}
          className="mt-8 h-12 px-6 bg-paper border-[3px] border-ink rounded-full shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] hover:-translate-x-[1px] hover:-translate-y-[1px]"
        >
          Back to Leagues
        </button>
      </div>
    </ArcadeBackground>
  );
}

