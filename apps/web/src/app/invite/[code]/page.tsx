'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { joinLeague } from '@/domains/league';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { getSession } from '@/lib/auth';
import { edgeFunctions } from '@/lib/api/edge-functions';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

interface LeagueInfo {
  league_id: string;
  name: string;
  creator_handle: string;
  member_count: number;
}

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.code as string;

  const [loading, setLoading] = useState(true);
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Fetch league info by invite code
  useEffect(() => {
    async function fetchLeagueInfo() {
      try {
        const response = await edgeFunctions.getLeagueByInviteCode(inviteCode);
        if (response.ok && response.data) {
          setLeagueInfo(response.data);
        } else {
          setError(response.error?.message || 'Invalid invite link');
        }
      } catch (err) {
        setError('Failed to load league information');
      } finally {
        setLoading(false);
      }
    }

    fetchLeagueInfo();
  }, [inviteCode]);

  // Check auth status
  useEffect(() => {
    async function checkAuth() {
      try {
        const session = await getSession();
        setIsSignedIn(!!session);

        // Show confirmation modal if signed in and have league info
        if (session && leagueInfo && !showConfirmModal) {
          setShowConfirmModal(true);
        }
      } catch (err) {
        console.error('Auth check error:', err);
      }
    }

    if (leagueInfo) {
      checkAuth();
    }
  }, [leagueInfo, showConfirmModal]);

  const handleJoin = useCallback(async () => {
    if (!isSignedIn) {
      setError('Please sign in to join this league');
      return;
    }

    setJoining(true);
    setShowConfirmModal(false);

    try {
      const result = await joinLeague(inviteCode);

      // Show success toast
      setToast({ message: `Successfully joined ${leagueInfo?.name || 'league'}!`, type: 'success' });

      // Navigate to league page after a brief delay
      setTimeout(() => {
        router.push(`/leagues/${result.league_id}`);
      }, 1500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join league';

      if (errorMessage.includes('already a member')) {
        setToast({ message: 'You are already a member of this league', type: 'error' });
        // Still navigate to the league
        setTimeout(() => {
          router.push(`/leagues/${leagueInfo?.league_id}`);
        }, 2000);
      } else {
        setToast({ message: `Failed to join league: ${errorMessage}`, type: 'error' });
        setJoining(false);
      }
    }
  }, [isSignedIn, inviteCode, router, leagueInfo]);

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading...</p>
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
            <h1 className="font-display text-2xl mb-4 text-ink">Invalid Invite Link</h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => router.push('/')}
                className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return (
    <ArcadeBackground>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>

        {/* Not signed in - show sign in prompt */}
        {!isSignedIn && (
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-3xl mb-4 text-ink">League Invite</h1>
            <p className="font-body text-lg mb-2 text-ink">
              You&apos;ve been invited to join
            </p>
            <p className="font-display text-2xl mb-6 text-ink">
              {leagueInfo?.name}
            </p>
            <div className="bg-cyanA/20 border-[3px] border-ink rounded-lg p-4 mb-6">
              <p className="font-bold text-sm text-ink">
                Created by: {leagueInfo?.creator_handle}
              </p>
              <p className="font-bold text-sm text-ink">
                {leagueInfo?.member_count} member{leagueInfo?.member_count !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="bg-yellow/20 border-[3px] border-ink rounded-lg p-4 mb-6">
              <p className="font-bold text-xs uppercase tracking-wide text-ink">
                Click &quot;Sign In&quot; in the top-right corner to join
              </p>
            </div>
            <button
              onClick={() => router.push('/')}
              className="h-14 w-full bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              Go Home
            </button>
          </div>
        )}

        {/* Signed in but waiting - just in case */}
        {isSignedIn && !showConfirmModal && !joining && (
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading...</p>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">
              Join League?
            </h2>

            <div className="bg-cyanA/20 border-[3px] border-ink rounded-[14px] p-4 mb-6">
              <p className="font-display text-xl text-ink text-center mb-2">
                {leagueInfo?.name}
              </p>
              <p className="font-bold text-sm text-ink text-center">
                by {leagueInfo?.creator_handle}
              </p>
              <p className="text-sm text-ink/80 text-center">
                {leagueInfo?.member_count} member{leagueInfo?.member_count !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 h-14 bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
              >
                Cancel
              </button>
              <button
                onClick={handleJoin}
                disabled={joining}
                className="flex-1 h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {joining ? 'Joining...' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className={`${
            toast.type === 'success' ? 'bg-green' : 'bg-red'
          } border-[4px] border-ink rounded-[18px] shadow-sticker-sm px-6 py-4 min-w-[300px]`}>
            <p className="font-bold text-base text-ink text-center">
              {toast.message}
            </p>
          </div>
        </div>
      )}
    </ArcadeBackground>
  );
}
