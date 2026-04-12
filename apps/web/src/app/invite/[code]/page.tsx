'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { joinLeague } from '@/domains/league';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { getSession } from '@/lib/auth';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.code as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const handleJoin = useCallback(async () => {
    if (!isSignedIn) {
      setError('Please sign in to join this league');
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const result = await joinLeague(inviteCode);
      // Redirect to the league page
      router.push(`/leagues/${result.league_id}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join league';

      if (errorMessage.includes('already a member')) {
        setError('You are already a member of this league.');
      } else {
        setError(errorMessage);
      }
      setJoining(false);
    }
  }, [isSignedIn, inviteCode, router]);

  useEffect(() => {
    async function checkAuth() {
      try {
        const session = await getSession();
        setIsSignedIn(!!session);

        if (session) {
          // Auto-join if signed in
          await handleJoin();
        } else {
          setLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check authentication');
        setLoading(false);
      }
    }

    checkAuth();
  }, [handleJoin]);

  if (loading || joining) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">
              {joining ? 'Joining league...' : 'Loading...'}
            </p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (error) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="absolute top-4 right-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">Unable to Join League</h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            <div className="flex flex-col gap-3">
              {!isSignedIn && (
                <p className="font-body text-sm text-ink/80 mb-2">
                  Click &quot;Sign In&quot; above to join this league
                </p>
              )}
              <button
                onClick={() => router.push('/leagues')}
                className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
              >
                Go to My Leagues
              </button>
              <button
                onClick={() => router.push('/')}
                className="h-14 w-full bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  // Not signed in - show sign in prompt
  return (
    <ArcadeBackground>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
          <h1 className="font-display text-3xl mb-4 text-ink">League Invite</h1>
          <p className="font-body text-lg mb-6 text-ink">
            You&apos;ve been invited to join a league!
          </p>
          <p className="font-body text-sm text-ink/80 mb-6">
            Sign in to accept this invitation and join the league.
          </p>
          <div className="bg-yellow/20 border-[3px] border-ink rounded-lg p-4 mb-6">
            <p className="font-bold text-xs uppercase tracking-wide text-ink">
              Click &quot;Sign In&quot; in the top-right corner to continue
            </p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="h-14 w-full bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
          >
            Go Home
          </button>
        </div>
      </div>
    </ArcadeBackground>
  );
}
