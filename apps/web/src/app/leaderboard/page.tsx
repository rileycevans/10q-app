'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getGlobalLeaderboard,
  type LeaderboardWindow,
  type LeaderboardMode,
  type ScoreType,
  type GlobalLeaderboardResponse,
} from '@/domains/leaderboard';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { LeaderboardTable } from '@/components/LeaderboardTable';
import { getSession } from '@/lib/auth';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function LeaderboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GlobalLeaderboardResponse | null>(null);
  const [window, setWindow] = useState<LeaderboardWindow>('7d');
  const [scoreType, setScoreType] = useState<ScoreType>('cumulative');
  const [mode, setMode] = useState<LeaderboardMode>('top');
  const [userPlayerId, setUserPlayerId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchLeaderboard() {
      if (!mounted) return;

      try {
        setLoading(true);
        setError(null);

        // Get user session for around-me mode
        const session = await getSession();
        if (session?.user?.id) {
          setUserPlayerId(session.user.id);
        } else if (mode === 'around') {
          setError('Please sign in to use "Around Me" mode');
          setLoading(false);
          return;
        }

        const result = await getGlobalLeaderboard({
          window,
          mode,
          limit: mode === 'top' ? 100 : undefined,
          count: mode === 'around' ? 12 : undefined,
          score_type: scoreType,
        });

        if (mounted) {
          setData(result);
        }
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load leaderboard';
        setError(errorMessage);
        console.error('Leaderboard page error:', err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchLeaderboard();

    return () => {
      mounted = false;
    };
  }, [window, scoreType, mode]);

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading Leaderboard...</p>
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
              {isAuthError ? 'Sign In Required' : 'Error Loading Leaderboard'}
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
              onClick={() => router.push('/')}
              className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              Go Home
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

        {/* Header */}
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6 text-center">
          <h1 className="font-display text-4xl mb-6 text-ink">Leaderboard</h1>

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
        {data && data.user_rank && (
          <div className="bg-cyanA border-[4px] border-ink rounded-[24px] shadow-sticker p-4 w-full max-w-2xl mb-6 text-center">
            <p className="font-display text-2xl font-bold text-ink">
              Your Rank: #{data.user_rank} of {data.total_players}
            </p>
            {data.user_entry && (
              <p className="font-body text-sm text-ink/80 mt-2">
                {scoreType === 'cumulative' ? 'Total' : 'Average'} Score:{' '}
                {data.user_entry.aggregated_score.toFixed(1)} • {data.user_entry.attempt_count} games
              </p>
            )}
          </div>
        )}

        {/* Leaderboard Table */}
        {data && (
          <div className="w-full max-w-2xl">
            <LeaderboardTable
              entries={data.entries}
              userRank={data.user_rank}
              userPlayerId={userPlayerId}
              scoreType={scoreType}
            />
          </div>
        )}

        {/* Back Button */}
        <button
          onClick={() => router.push('/')}
          className="mt-8 h-12 px-6 bg-paper border-[3px] border-ink rounded-full shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] hover:-translate-x-[1px] hover:-translate-y-[1px]"
        >
          Go Home
        </button>
      </div>
    </ArcadeBackground>
  );
}

