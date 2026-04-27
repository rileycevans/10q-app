'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { BottomDock } from '@/components/BottomDock';
import { SignInModal } from '@/components/SignInModal';
import { trackScreenView, trackAppError } from '@/lib/analytics';
import { edgeFunctions } from '@/lib/api/edge-functions';
import { getCurrentQuiz } from '@/domains/quiz';
import { supabase } from '@/lib/supabase/client';
import { formatTimeUntilNextQuiz } from '@/lib/time';

export default function HomePage() {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);
  const [showScoringModal, setShowScoringModal] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [streak, setStreak] = useState<number | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(true);

  useEffect(() => {
    trackScreenView({ screen: 'home', route: '/' });

    async function warmSessionAndCheckCompletion() {
      try {
        // Warm the session early so /play doesn't have to wait for it
        const { ensureSession } = await import('@/lib/auth');
        const session = await ensureSession();
        if (!session) {
          setIsSignedIn(false);
          setIsAnonymous(true);
          return;
        }
        setIsSignedIn(true);
        setIsAnonymous(session.user.is_anonymous ?? true);
        const { data: player } = await supabase
          .from('players')
          .select('current_streak')
          .eq('id', session.user.id)
          .single();
        if (player) setStreak(player.current_streak);
        if (session.user.app_metadata?.role === 'admin') setIsAdmin(true);
        setAvatarUrl(session.user.user_metadata?.avatar_url ?? session.user.user_metadata?.picture ?? null);

        // Check if the user has already completed today's quiz
        const currentQuiz = await getCurrentQuiz();
        if (currentQuiz) {
          const { data: attempt } = await supabase
            .from('attempts')
            .select('finalized_at')
            .eq('quiz_id', currentQuiz.quiz_id)
            .eq('player_id', session.user.id)
            .not('finalized_at', 'is', null)
            .maybeSingle();
          if (attempt) setQuizCompleted(true);
        }
      } catch (err) {
        // Non-fatal: home renders fine without warm session, but log so silent
        // failures (network, RLS, expired token) are visible in Sentry/PostHog.
        trackAppError({
          location: 'home_warm_session',
          message: err instanceof Error ? err.message : 'Failed to warm session',
        });
        setIsSignedIn(false);
        setIsAnonymous(true);
      }
    }
    warmSessionAndCheckCompletion();
  }, []);

  // Countdown timer for next quiz refresh
  useEffect(() => {
    if (!quizCompleted) return;

    function updateCountdown() {
      setCountdown(formatTimeUntilNextQuiz());
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [quizCompleted]);

  const isSentryEnabled = !!process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NODE_ENV === 'production';

  const handleResetQuiz = async () => {
    if (!isAdmin) return;
    
    setIsResetting(true);
    try {
      const currentQuiz = await getCurrentQuiz();
      if (!currentQuiz) {
        alert('No quiz available');
        return;
      }

      const response = await edgeFunctions.deleteAttempt(currentQuiz.quiz_id);
      if (response.ok) {
        // Clear completed state so the UI flips back to PLAY NOW
        setQuizCompleted(false);
        router.refresh();
      } else {
        trackAppError({
          location: 'home_reset_quiz',
          message: response.error?.message || 'Failed to reset quiz',
        });
        alert(response.error?.message || 'Failed to reset quiz');
      }
    } catch (error) {
      trackAppError({
        location: 'home_reset_quiz',
        message: error instanceof Error ? error.message : 'Failed to reset quiz',
      });
      alert(error instanceof Error ? error.message : 'Failed to reset quiz');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <ArcadeBackground>
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <div className="mb-6 flex justify-center px-1">
              {/* Plain img: drop any transparent PNG at public/brand/10q-logo.png — no width/height sync */}
              <img
                src="/brand/10q-logo.png"
                alt="10Q"
                className="h-auto w-[min(100%,500px)] max-w-full object-contain"
                decoding="async"
                fetchPriority="high"
              />
            </div>
            {quizCompleted ? (
              <>
                <h1 className="font-display text-3xl mb-4 text-ink">Come Back Tomorrow!</h1>
                <p className="font-body text-sm mb-4 text-ink/80">
                  Next quiz releases in:
                </p>
                <p className="font-display text-2xl mb-8 text-ink">
                  {countdown || 'Calculating...'}
                </p>
                <div className="space-y-3">
                  <Link
                    href="/results"
                    className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2"
                  >
                    VIEW RESULTS
                  </Link>
                  <Link
                    href="/leaderboard"
                    className="block w-full h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-green focus-visible:outline-offset-2"
                  >
                    LEADERBOARD
                  </Link>
                  <Link
                    href="/leagues"
                    className="block w-full h-14 bg-yellow border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-yellow focus-visible:outline-offset-2"
                  >
                    LEAGUES
                  </Link>
                  {isAdmin && (
                    <button
                      onClick={handleResetQuiz}
                      disabled={isResetting}
                      className="block w-full h-14 bg-red border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-red focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isResetting ? 'RESETTING...' : 'RESET QUIZ'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="font-body text-sm mb-8 text-ink/80">
                  10 questions. One attempt. New quiz, new topic, every single day.
                </p>
                <div className="space-y-3">
                  <Link
                    href="/play"
                    className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2"
                  >
                    PLAY NOW
                  </Link>
                  <Link
                    href="/leaderboard"
                    className="block w-full h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-green focus-visible:outline-offset-2"
                  >
                    LEADERBOARD
                  </Link>
                  <Link
                    href="/leagues"
                    className="block w-full h-14 bg-yellow border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-yellow focus-visible:outline-offset-2"
                  >
                    LEAGUES
                  </Link>
                  <button
                    onClick={() => setShowScoringModal(true)}
                    className="w-full text-xs text-ink/60 hover:text-ink underline font-bold transition-colors mt-2"
                  >
                    How is my score calculated?
                  </button>
                  {isSentryEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        // Trigger a test error that should be captured by Sentry
                        throw new Error('Sentry test error from HomePage');
                      }}
                      className="w-full text-[10px] text-ink/50 hover:text-ink/80 underline font-bold transition-colors"
                    >
                      Trigger Sentry test error
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={handleResetQuiz}
                      disabled={isResetting}
                      className="block w-full h-14 bg-red border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-red focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isResetting ? 'RESETTING...' : 'RESET QUIZ'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <BottomDock
          streak={streak}
          avatarUrl={avatarUrl}
          isAnonymous={isAnonymous}
          onRankClick={() => router.push('/leaderboard')}
          onStreakClick={() => router.push('/leaderboard')}
          onLeagueClick={() => router.push('/leagues')}
          onSettingsClick={() => router.push('/settings')}
          onProfileClick={() => router.push('/profile')}
        />
      </div>

      {/* Scoring Modal */}
      {showScoringModal && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowScoringModal(false)}
        >
          <div
            className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-2xl font-bold text-ink">SCORING SYSTEM</h2>
              <button
                onClick={() => setShowScoringModal(false)}
                className="w-8 h-8 bg-ink text-paper rounded-full flex items-center justify-center font-bold text-lg hover:bg-ink/80 transition-colors"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div className="bg-cyanA/20 border-[3px] border-ink rounded-[14px] p-3">
                <div className="font-bold text-sm text-ink mb-2">BASE POINTS</div>
                <div className="text-base text-ink">5 points for each correct answer</div>
              </div>

              <div className="bg-yellow/20 border-[3px] border-ink rounded-[14px] p-3">
                <div className="font-bold text-sm text-ink mb-2">SPEED BONUS</div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">0 - 3 seconds</span>
                    <span className="font-bold text-ink">+5 bonus</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">3 - 5 seconds</span>
                    <span className="font-bold text-ink">+4 bonus</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">5 - 7 seconds</span>
                    <span className="font-bold text-ink">+3 bonus</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">7 - 9 seconds</span>
                    <span className="font-bold text-ink">+2 bonus</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">9 - 11 seconds</span>
                    <span className="font-bold text-ink">+1 bonus</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">11+ seconds</span>
                    <span className="font-bold text-ink">+0 bonus</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-green/20 border-[3px] border-ink rounded-[14px] p-3 mb-4">
              <div className="font-bold text-sm text-ink mb-1">MAXIMUM SCORE</div>
              <div className="text-base text-ink">10 points per question × 10 questions = 100 points</div>
            </div>

            <button
              onClick={() => setShowScoringModal(false)}
              className="w-full h-12 bg-cyanA border-[3px] border-ink rounded-[14px] shadow-sticker-sm font-bold text-base text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              GOT IT
            </button>
          </div>
        </div>
      )}

      {/* Sign In Modal */}
      <SignInModal isOpen={showSignInModal} onClose={() => setShowSignInModal(false)} />
    </ArcadeBackground>
  );
}
