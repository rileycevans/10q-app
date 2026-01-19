'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { finalizeAttempt } from '@/domains/attempt';
import { ArcadeBackground } from '@/components/ArcadeBackground';

export default function FinalizePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalScore, setTotalScore] = useState<number | null>(null);

  useEffect(() => {
    async function finalize() {
      try {
        // Get attempt ID from somewhere (should be in state/context)
        // For now, we'll need to get it from the resume call
        const { getCurrentQuiz } = await import('@/domains/quiz');
        const { startAttempt } = await import('@/domains/attempt');
        
        const currentQuiz = await getCurrentQuiz();
        if (!currentQuiz) {
          setError('No quiz available');
          setLoading(false);
          return;
        }

        const attemptState = await startAttempt(currentQuiz.quiz_id);
        
        if (attemptState.state !== 'READY_TO_FINALIZE') {
          // Already finalized or still in progress
          if (attemptState.state === 'FINALIZED') {
            router.push('/results');
          } else {
            router.push(`/play/q/${attemptState.current_index}`);
          }
          return;
        }

        const result = await finalizeAttempt(attemptState.attempt_id);
        setTotalScore(result.total_score);
        
        // Redirect to results after brief delay with attempt_id
        setTimeout(() => {
          router.push(`/results?attempt_id=${attemptState.attempt_id}`);
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to finalize attempt');
      } finally {
        setLoading(false);
      }
    }

    finalize();
  }, [router]);

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Finalizing...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (error) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <p className="font-bold text-lg text-ink mb-4">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink"
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
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
          <h1 className="font-display text-3xl mb-4 text-ink">Quiz Complete!</h1>
          {totalScore !== null && (
            <p className="font-bold text-2xl mb-6 text-ink">
              Total Score: {totalScore} points
            </p>
          )}
          <p className="font-body text-sm text-ink/80">Redirecting to results...</p>
        </div>
      </div>
    </ArcadeBackground>
  );
}

