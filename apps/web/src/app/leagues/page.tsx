'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMyLeagues, joinLeague, type League } from '@/domains/league';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { LeagueCard } from '@/components/LeagueCard';
import { getSession } from '@/lib/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function LeaguesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchLeagues() {
      if (!mounted) return;

      try {
        setLoading(true);
        setError(null);

        const session = await getSession();
        if (!session) {
          setError('Please sign in to view your leagues');
          setLoading(false);
          return;
        }

        const result = await getMyLeagues();
        if (mounted) {
          setLeagues(result);
        }
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load leagues';
        setError(errorMessage);
        console.error('Leagues page error:', err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchLeagues();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || joining) return;

    setJoining(true);
    setJoinError(null);

    try {
      const result = await joinLeague(joinCode.trim());
      router.push(`/leagues/${result.league_id}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Invalid invite code');
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading Leagues...</p>
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
          <div className="absolute top-4 right-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">
              {isAuthError ? 'Sign In Required' : 'Error Loading Leagues'}
            </h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            {isAuthError && (
              <div className="mb-6">
                <p className="font-body text-sm mb-4 text-ink/80">
                  Click the &quot;Sign In&quot; button in the top-right corner, then refresh this page.
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
          <h1 className="font-display text-4xl mb-6 text-ink">My Leagues</h1>
          <div className="flex gap-3">
            <Link
              href="/leagues/create"
              className="flex-1 h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
            >
              Create League
            </Link>
          </div>

          {/* Join League */}
          <form onSubmit={handleJoin} className="mt-4 flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setJoinError(null);
              }}
              placeholder="Enter invite code"
              maxLength={6}
              disabled={joining}
              className="flex-1 h-12 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-mono font-bold text-base text-ink text-center uppercase tracking-[0.3em] placeholder:text-ink/40 placeholder:tracking-normal placeholder:font-body focus:outline-none focus:ring-[3px] focus:ring-cyanA focus:ring-offset-2 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={joinCode.trim().length === 0 || joining}
              className="h-12 px-5 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joining ? 'Joining...' : 'Join'}
            </button>
          </form>
          {joinError && (
            <div className="mt-2 bg-red border-[3px] border-ink rounded-lg p-2">
              <p className="font-body text-sm font-bold text-ink text-center">{joinError}</p>
            </div>
          )}
        </div>

        {/* League List */}
        {leagues.length === 0 ? (
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-2xl text-center">
            <p className="font-body font-bold text-lg text-ink mb-4">No leagues yet</p>
            <p className="font-body text-sm text-ink/80 mb-6">
              Create your first league to compete with friends!
            </p>
            <Link
              href="/leagues/create"
              className="inline-block h-12 px-6 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
            >
              Create League
            </Link>
          </div>
        ) : (
          <div className="w-full max-w-2xl space-y-4">
            {leagues.map((league) => (
              <LeagueCard key={league.league_id} league={league} />
            ))}
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

