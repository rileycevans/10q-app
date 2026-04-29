'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { useGameStore, useGameState } from '@/components/GameProvider';
import { trackScreenView, trackQuizStart, trackQuizUnavailable, trackAppError } from '@/lib/analytics';
import { formatTimeUntilNextQuiz } from '@/lib/time';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(() => import('@/components/AuthButton').then(mod => mod.AuthButton), { ssr: false });

export default function PlayPage() {
  const router = useRouter();
  const store = useGameStore();
  const game = useGameState();

  const [countdown, setCountdown] = useState('');
  const [readyCount, setReadyCount] = useState(3);
  const [showCountdown, setShowCountdown] = useState(false);
  const trackedRef = useRef(false);

  // ── Kick off the single prep pipeline immediately ────────────────────────
  useEffect(() => {
    trackScreenView({ screen: 'play', route: '/play' });
    store.prepare();

    // Warm the routes the user will hit during/after a play session, so the
    // first question render and the post-quiz finalize/results jumps don't
    // block on chunk downloads.
    router.prefetch('/play/q/1');
    router.prefetch('/play/finalize');
    router.prefetch('/results');
    router.prefetch('/tomorrow');
  }, [store, router]);

  // ── React to game state changes ──────────────────────────────────────────
  useEffect(() => {
    if (game.phase !== 'ready' || !game.attempt) return;
    if (trackedRef.current) return;
    trackedRef.current = true;

    const attempt = game.attempt;

    if (attempt.state === 'FINALIZED') {
      router.push('/tomorrow');
    } else if (attempt.current_index <= 10) {
      trackQuizStart({
        quiz_id: game.quizId!,
        attempt_id: attempt.attempt_id,
        is_resume: attempt.current_index > 1,
      });

      if (attempt.current_index === 1) {
        // Fresh start — show 3-2-1-GO countdown
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowCountdown(true);
      } else {
        // Resume — skip straight to current question
        router.push(`/play/q/${attempt.current_index}`);
      }
    } else if (attempt.state === 'READY_TO_FINALIZE') {
      router.push('/play/finalize');
    }
  }, [game.phase, game.attempt, game.quizId, router]);

  // Helper function for countdown calculation
  const updateCountdown = () => {
    setCountdown(formatTimeUntilNextQuiz());
  };

  // ── Handle "no quiz" error specifically ──────────────────────────────────
  useEffect(() => {
    if (game.phase === 'error' && game.error?.includes('11:30')) {
      trackQuizUnavailable({ reason: 'NO_QUIZ_AVAILABLE' });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      updateCountdown();
      const interval = setInterval(updateCountdown, 1000);
      return () => clearInterval(interval);
    }
    if (game.phase === 'error' && game.error) {
      trackAppError({ location: 'play_initialize', message: game.error });
    }
  }, [game.phase, game.error]);

  // ── 3-2-1-GO countdown timer ─────────────────────────────────────────────
  useEffect(() => {
    if (!showCountdown) return;

    if (readyCount < 0) {
      router.push(`/play/q/${game.attempt!.current_index}`);
      return;
    }

    const timer = setTimeout(() => {
      setReadyCount(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [showCountdown, readyCount, game.attempt, router]);

  // ── Render: countdown animation ──────────────────────────────────────────
  if (showCountdown) {
    const labels = ['GO!', '1', '2', '3'];
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <AnimatePresence mode="wait">
            <motion.div
              key={readyCount}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="text-center"
            >
              <span className="font-display text-[80px] text-paper drop-shadow-[0_4px_0_var(--ink)]">
                {labels[readyCount]}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
      </ArcadeBackground>
    );
  }

  // ── Render: error state ──────────────────────────────────────────────────
  if (game.phase === 'error') {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="absolute top-4 right-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">
              Come Back Later
            </h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{game.error}</p>
            {countdown && (
              <>
                <p className="font-body text-sm mb-4 text-ink/80">
                  Next quiz releases in:
                </p>
                <p className="font-display text-2xl mb-8 text-ink">{countdown}</p>
              </>
            )}
            <div className="flex flex-col gap-3">
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

  // ── Render: loading (idle or in-flight) ──────────────────────────────────
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
