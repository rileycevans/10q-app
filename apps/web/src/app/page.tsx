'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { BottomDock } from '@/components/BottomDock';
import dynamic from 'next/dynamic';
import { edgeFunctions } from '@/lib/api/edge-functions';
import { getCurrentQuiz } from '@/domains/quiz';

// Dynamically import AuthButton to avoid SSR issues
const AuthButton = dynamic(() => import('@/components/AuthButton').then(mod => ({ default: mod.AuthButton })), {
  ssr: false,
  loading: () => (
    <div className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm opacity-50">
      <span className="text-xs text-ink">Loading...</span>
    </div>
  ),
});

export default function HomePage() {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);
  const isDevelopment = process.env.NODE_ENV === 'development';

  const handleResetQuiz = async () => {
    if (!isDevelopment) return;
    
    setIsResetting(true);
    try {
      const currentQuiz = await getCurrentQuiz();
      if (!currentQuiz) {
        alert('No quiz available');
        return;
      }

      const response = await edgeFunctions.deleteAttempt(currentQuiz.quiz_id);
      if (response.ok) {
        // Refresh the page to clear any cached state
        router.refresh();
      } else {
        alert(response.error?.message || 'Failed to reset quiz');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to reset quiz');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <ArcadeBackground>
      <div className="flex flex-col min-h-screen">
        <div className="absolute top-4 left-4 z-10">
          <AuthButton />
        </div>
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-4xl mb-4 text-ink">10Q</h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">
              Daily Trivia Game
            </p>
            <p className="font-body text-sm mb-8 text-ink/80">
              10 questions. One attempt. Every day at 11:30 UTC.
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
              {isDevelopment && (
                <button
                  onClick={handleResetQuiz}
                  disabled={isResetting}
                  className="block w-full h-14 bg-red border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-red focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isResetting ? 'RESETTING...' : 'RESET QUIZ (DEV)'}
                </button>
              )}
            </div>
          </div>
        </div>
        <BottomDock
          onRankClick={() => router.push('/leaderboard')}
          onStreakClick={() => router.push('/leaderboard')}
          onLeagueClick={() => router.push('/leagues')}
          onSettingsClick={() => router.push('/settings')}
        />
      </div>
    </ArcadeBackground>
  );
}
