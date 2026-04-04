'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { finalizeAttempt } from '@/domains/attempt';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { useGameState } from '@/components/GameProvider';
import { trackScreenView, trackQuizFinalized, trackAppError, setPersonProperties } from '@/lib/analytics';

export default function FinalizePage() {
  return (
    <Suspense fallback={
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Finalizing...</p>
          </div>
        </div>
      </ArcadeBackground>
    }>
      <FinalizeContent />
    </Suspense>
  );
}

function FinalizeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const game = useGameState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalScore, setTotalScore] = useState<number | null>(null);

  useEffect(() => {
    async function finalize() {
      try {
        trackScreenView({ screen: 'finalize', route: '/play/finalize' });

        // 1. Try store (normal flow from gameplay)
        // 2. Try URL param
        // 3. Try sessionStorage (hard refresh recovery)
        // 4. Last resort: re-discover from server
        let attemptId = game.attempt?.attempt_id
          || searchParams.get('attempt_id')
          || null;

        if (!attemptId) {
          const cached = sessionStorage.getItem('attempt_state');
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              attemptId = parsed.attempt_id;
            } catch {
              // Invalid cache
            }
          }
        }

        if (!attemptId) {
          const { getCurrentQuiz } = await import('@/domains/quiz');
          const { startAttempt } = await import('@/domains/attempt');
          const currentQuiz = await getCurrentQuiz();
          if (!currentQuiz) {
            setError('No quiz available');
            setLoading(false);
            return;
          }
          const attemptState = await startAttempt(currentQuiz.quiz_id);
          attemptId = attemptState.attempt_id;

          if (attemptState.state === 'FINALIZED') {
            router.push(`/results?attempt_id=${attemptId}`);
            return;
          }
          if (attemptState.state !== 'READY_TO_FINALIZE') {
            router.push(`/play/q/${attemptState.current_index}`);
            return;
          }
        }

        const result = await finalizeAttempt(attemptId);
        setTotalScore(result.total_score);

        trackQuizFinalized({
          attempt_id: result.attempt_id,
          total_score: result.total_score,
        });

        // Update person properties for cohort analysis
        setPersonProperties({
          last_quiz_score: result.total_score,
          last_quiz_at: result.finalized_at,
          current_streak: result.current_streak,
          longest_streak: result.longest_streak,
        });

        sessionStorage.removeItem('attempt_state');

        const streakParams = result.current_streak > 0
          ? `&streak=${result.current_streak}&longest=${result.longest_streak}`
          : '';
        setTimeout(() => {
          router.push(`/results?attempt_id=${attemptId}${streakParams}`);
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to finalize attempt');
        trackAppError({
          location: 'finalize_attempt',
          message: err instanceof Error ? err.message : 'Failed to finalize attempt',
        });
      } finally {
        setLoading(false);
      }
    }

    finalize();
  }, [router, searchParams]);

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
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 20,
            duration: 0.5,
          }}
          className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center"
        >
          <motion.h1
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="font-display text-3xl mb-4 text-ink"
          >
            Quiz Complete!
          </motion.h1>
          {totalScore !== null && (
            <motion.p
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.5, type: 'spring', stiffness: 200, damping: 15 }}
              className="font-bold text-2xl mb-6 text-ink"
            >
              Total Score: {totalScore} points
            </motion.p>
          )}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="font-body text-sm text-ink/80"
          >
            Redirecting to results...
          </motion.p>
        </motion.div>
      </div>
    </ArcadeBackground>
  );
}
