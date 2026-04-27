'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { trackScreenView, trackAppError } from '@/lib/analytics';
import { formatTimeUntilNextQuiz } from '@/lib/time';

export default function TomorrowPage() {
  const [countdown, setCountdown] = useState<string>('');
  const [resultsUrl, setResultsUrl] = useState('/results');

  useEffect(() => {
    trackScreenView({
      screen: 'tomorrow',
      route: '/tomorrow',
    });

    async function resolveAttemptId() {
      try {
        const { getCurrentQuiz } = await import('@/domains/quiz');
        const { startAttempt } = await import('@/domains/attempt');
        const quiz = await getCurrentQuiz();
        if (!quiz) return;
        const attempt = await startAttempt(quiz.quiz_id);
        if (attempt.state === 'FINALIZED') {
          setResultsUrl(`/results?attempt_id=${attempt.attempt_id}`);
        }
      } catch (err) {
        // Non-fatal: fall back to /results without attempt_id, but log it.
        trackAppError({
          location: 'tomorrow_resolve_attempt',
          message: err instanceof Error ? err.message : 'Failed to resolve attempt id',
        });
      }
    }
    resolveAttemptId();

    function updateCountdown() {
      setCountdown(formatTimeUntilNextQuiz());
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
          <h1 className="font-display text-3xl mb-4 text-ink">Come Back Tomorrow</h1>
          <p className="font-body font-bold text-lg mb-6 text-ink">
            You&apos;ve already completed today&apos;s quiz!
          </p>
          <p className="font-body text-sm mb-4 text-ink/80">
            Next quiz releases in:
          </p>
          <p className="font-display text-2xl mb-8 text-ink">
            {countdown || 'Calculating...'}
          </p>
          <div className="space-y-3">
            <Link
              href={resultsUrl}
              className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
            >
              View Results
            </Link>
            <Link
              href="/"
              className="block w-full h-14 bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}

