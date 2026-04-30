'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore, useGameState } from '@/components/GameProvider';
import { submitAnswer, resumeAttempt } from '@/domains/attempt';
import { edgeFunctions } from '@/lib/api/edge-functions';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { HUD } from '@/components/HUD';
import { QuestionCard } from '@/components/QuestionCard';
import { AnswerButton } from '@/components/AnswerButton';
import type { AnswerFeedback } from '@/components/AnswerButton';
import type { QuizQuestion } from '@/domains/quiz';
import type { AttemptState } from '@/domains/attempt';
import { trackScreenView, trackQuestionView, trackAnswerSubmit, trackAppError } from '@/lib/analytics';

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const questionIndex = parseInt(params.index as string, 10);

  const store = useGameStore();
  const game = useGameState();

  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [totalTime, setTotalTime] = useState<number>(12000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<AnswerFeedback>('idle');
  const [recoveryError, _setRecoveryError] = useState<string | null>(null);

  // Wall-clock-based timer. `deadlineRef` is the absolute time the question
  // expires. A single requestAnimationFrame loop keeps `timeRemaining` in
  // sync. This avoids the drift and jitter of setInterval-based tickers
  // that restart every 100ms as timeRemaining state changes.
  const deadlineRef = useRef<number | null>(null);

  // Derive current question from store
  const currentQuestion: QuizQuestion | null =
    game.questions?.find(q => q.order_index === questionIndex) ?? null;
  const attempt: AttemptState | null = game.attempt;

  // ── Recovery: if store is empty (hard refresh), trigger prepare ──────────
  useEffect(() => {
    if (game.phase === 'idle') {
      store.prepare();
    }
  }, [game.phase, store]);

  // ── Redirect if store says we're on the wrong question ──────────────────
  useEffect(() => {
    if (!attempt) return;

    if (attempt.state === 'FINALIZED') {
      router.push('/results');
      return;
    }
    if (attempt.state === 'READY_TO_FINALIZE') {
      router.push(`/results?attempt_id=${attempt.attempt_id}`);
      return;
    }
    if (attempt.current_index !== questionIndex) {
      router.push(`/play/q/${attempt.current_index}`);
    }
  }, [attempt, questionIndex, router]);

  // ── Reset per-question state when index changes ─────────────────────────
  useEffect(() => {
    // Prefetch next route
    if (questionIndex < 10) {
      router.prefetch(`/play/q/${questionIndex + 1}`);
    } else if (questionIndex === 10) {
      router.prefetch('/results');
    }
  }, [questionIndex, router]);

  // Reset state when question changes (use layout effect to avoid flash)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedback('idle');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedAnswerId(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSubmitting(false);
  }, [questionIndex]);

  // ── Initialize timer deadline on question mount ──────────────────────────
  // Keyed on attempt_id + questionIndex so it runs exactly once per question
  // transition. Sets an absolute wall-clock deadline in a ref — the rAF
  // loop below polls that deadline. Late server responses (e.g. background
  // submit of the previous question) won't perturb the in-flight countdown.
  useEffect(() => {
    if (!attempt) return;

    const now = Date.now();

    if (!attempt.current_question_expires_at) {
      // Q1 path: server hasn't set an expiry yet. Start the countdown from
      // now and tell the server in the background.
      deadlineRef.current = now + 12000;
      setTimeRemaining(12000);
      setTotalTime(12000);

      (async () => {
        try {
          const res = await edgeFunctions.startQuestionTimer(attempt.attempt_id);
          if (res.ok && res.data?.question_expires_at) {
            // Mirror into the store so server-authoritative scoring sees it.
            // Don't touch deadlineRef — the mount moment is what the user
            // experienced; the server's expiry would be ~1–2s later due to
            // round-trip latency and would visibly jump the timer.
            store.setAttempt({
              ...attempt,
              current_question_expires_at: res.data.question_expires_at,
            });
          }
        } catch (err) {
          console.error('start-question-timer failed; falling back to client 12s', err);
        }
      })();
      return;
    }

    // Expiry exists (Q2-10 via optimistic nav, or recovery path). Derive
    // the deadline from it.
    const expiresAt = new Date(attempt.current_question_expires_at).getTime();
    deadlineRef.current = expiresAt;
    const remaining = Math.max(0, expiresAt - now);
    setTimeRemaining(Math.min(12000, remaining));
    setTotalTime(12000);
    // Intentionally omit `attempt` and `store` from deps — we only want
    // this to run on question changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.attempt_id, questionIndex]);

  // ── Track question view ─────────────────────────────────────────────────
  useEffect(() => {
    if (!attempt || !currentQuestion) return;

    trackScreenView({
      screen: 'question',
      route: `/play/q/${questionIndex}`,
      quiz_id: game.quizId || undefined,
      attempt_id: attempt.attempt_id,
    });

    trackQuestionView({
      quiz_id: game.quizId || currentQuestion.quiz_id,
      attempt_id: attempt.attempt_id,
      question_id: currentQuestion.question_id,
      question_index: questionIndex,
    });
  }, [attempt, currentQuestion, questionIndex, game.quizId]);

  // ── Tick timer via requestAnimationFrame + wall-clock deadline ──────────
  // Polls `deadlineRef` on every frame while the question is active. Because
  // we're reading the deadline from a ref (not from state) and deriving the
  // remaining time from `Date.now()` directly, the countdown can't drift or
  // jump from re-renders — the only state change is setTimeRemaining, which
  // just updates the visible number/bar.
  useEffect(() => {
    if (isSubmitting) return;
    if (deadlineRef.current == null) return;

    let rafId: number;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline == null) return;
      const remaining = Math.max(0, deadline - Date.now());
      setTimeRemaining(remaining);
      if (remaining > 0) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isSubmitting, attempt?.attempt_id, questionIndex]);

  // ── Auto-advance on timeout ─────────────────────────────────────────────
  // Mirrors the answer-tap path: navigate optimistically so the timeout feels
  // as snappy as a tapped answer; fire the submit in the background with a
  // null selected_answer_id so the server marks it as a timeout.
  useEffect(() => {
    if (timeRemaining === null || timeRemaining > 0) return;
    if (isSubmitting || !currentQuestion || !attempt) return;

    setIsSubmitting(true);

    const nextIndex = questionIndex + 1;
    const isLastQuestion = nextIndex > 10;
    const firstAnswerId = currentQuestion.answers[0]?.answer_id;

    // Fire the submit in the background. If the first answer is missing
    // (shouldn't happen on real data), fall back to resumeAttempt.
    const submitPromise = firstAnswerId
      ? submitAnswer(attempt.attempt_id, currentQuestion.question_id, firstAnswerId)
          .then((result) => {
            trackAnswerSubmit({
              quiz_id: game.quizId || currentQuestion.quiz_id,
              attempt_id: attempt.attempt_id,
              question_id: currentQuestion.question_id,
              question_index: questionIndex,
              answer_id: null,
              is_correct: result.is_correct,
              time_ms: result.time_ms,
              base_points: result.base_points,
              bonus_points: result.bonus_points,
              total_points: result.total_points,
              answer_kind: 'timeout',
              question_tags: currentQuestion.tags,
            });
            return result;
          })
          .catch((err) => {
            trackAppError({
              location: 'timeout_submit',
              message: err instanceof Error ? err.message : 'Failed to submit timeout answer',
            });
            return null;
          })
      : Promise.resolve(null);

    if (isLastQuestion) {
      // Last question: await so finalize-attempt sees READY_TO_FINALIZE.
      submitPromise.then((result) => {
        if (result) {
          store.setAttempt({
            attempt_id: result.attempt_id,
            quiz_id: attempt.quiz_id,
            current_index: result.current_index,
            current_question_started_at: result.question_started_at,
            current_question_expires_at: result.question_expires_at,
            state: result.current_index > 10 ? 'READY_TO_FINALIZE' : 'IN_PROGRESS',
          });
          router.push(`/results?attempt_id=${attempt.attempt_id}`);
          return;
        }
        // Submit failed — recover via resumeAttempt.
        resumeAttempt(attempt.attempt_id).then((newAttempt) => {
          store.setAttempt(newAttempt);
          router.push(`/results?attempt_id=${attempt.attempt_id}`);
        });
      });
      return;
    }

    // Non-final question: navigate optimistically, reuse mount-time deadline.
    const optimisticStartedAt = new Date();
    const optimisticExpiresAt = new Date(optimisticStartedAt.getTime() + 12000);

    store.setAttempt({
      attempt_id: attempt.attempt_id,
      quiz_id: attempt.quiz_id,
      current_index: nextIndex,
      current_question_started_at: optimisticStartedAt.toISOString(),
      current_question_expires_at: optimisticExpiresAt.toISOString(),
      state: 'IN_PROGRESS',
    });

    router.push(`/play/q/${nextIndex}`);
  }, [timeRemaining, currentQuestion, isSubmitting, attempt, router, store, game.quizId, questionIndex]);

  // ── Answer handler ──────────────────────────────────────────────────────
  const handleAnswerClick = async (answerId: string) => {
    if (!currentQuestion || !attempt || isSubmitting) return;

    setSelectedAnswerId(answerId);
    setIsSubmitting(true);
    setFeedback('committed');

    const nextIndex = questionIndex + 1;
    const isLastQuestion = nextIndex > 10;

    const submitPromise = submitAnswer(
      attempt.attempt_id,
      currentQuestion.question_id,
      answerId,
    )
      .then((result) => {
        trackAnswerSubmit({
          quiz_id: game.quizId || currentQuestion.quiz_id,
          attempt_id: result.attempt_id,
          question_id: currentQuestion.question_id,
          question_index: questionIndex,
          answer_id: answerId,
          is_correct: result.is_correct,
          time_ms: result.time_ms,
          base_points: result.base_points,
          bonus_points: result.bonus_points,
          total_points: result.total_points,
          answer_kind: 'selected',
          question_tags: currentQuestion.tags,
        });
        return result;
      })
      .catch((err) => {
        console.error('Failed to submit answer:', err);
        trackAppError({
          location: 'question_submit',
          message: err instanceof Error ? err.message : 'Failed to submit answer',
        });
        return null;
      });

    if (isLastQuestion) {
      // On the final question we have to wait for the server to advance
      // current_index before finalize-attempt will succeed. Await the
      // submit and let the server's authoritative state drive the store.
      const result = await submitPromise;
      if (result) {
        store.setAttempt({
          attempt_id: result.attempt_id,
          quiz_id: attempt.quiz_id,
          current_index: result.current_index,
          current_question_started_at: result.question_started_at,
          current_question_expires_at: result.question_expires_at,
          state: result.current_index > 10 ? 'READY_TO_FINALIZE' : 'IN_PROGRESS',
        });
      }
      router.push(`/results?attempt_id=${attempt.attempt_id}`);
      return;
    }

    // Non-final question: navigate optimistically. The next question is
    // already preloaded in game.questions, so there's nothing to wait for.
    // We use the tap moment as the start of the 12s window so the timer
    // doesn't jump when the server response lands — the server's expiry
    // would be ~100-300ms later due to network latency, but that latency
    // is not time the user experienced on the question.
    const optimisticStartedAt = new Date();
    const optimisticExpiresAt = new Date(optimisticStartedAt.getTime() + 12000);

    store.setAttempt({
      attempt_id: attempt.attempt_id,
      quiz_id: attempt.quiz_id,
      current_index: nextIndex,
      current_question_started_at: optimisticStartedAt.toISOString(),
      current_question_expires_at: optimisticExpiresAt.toISOString(),
      state: 'IN_PROGRESS',
    });

    router.push(`/play/q/${nextIndex}`);
  };

  // ── Render: loading (recovery from hard refresh) ────────────────────────
  if (game.phase === 'loading' || game.phase === 'idle' || !currentQuestion || !attempt) {
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

  if (game.phase === 'error' || recoveryError) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <p className="font-bold text-lg text-ink mb-4">{game.error || recoveryError}</p>
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

  // ── Render: question ────────────────────────────────────────────────────
  return (
    <ArcadeBackground>
      <div className="flex flex-col min-h-screen relative">
        {/* Unified top bar: progress + timer */}
        {(() => {
          // Treat "low time" as ≤3s remaining — switches the bar fill and
          // the timer readout to red so the urgency is visually obvious.
          const displaySeconds = timeRemaining !== null ? timeRemaining / 1000 : totalTime / 1000;
          const isLowTime = timeRemaining !== null && timeRemaining <= 3000;
          return (
            <div className="flex items-center gap-3 w-full px-4 py-3">
              <HUD progress={questionIndex} />
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-1 h-5 bg-paper/40 border-[3px] border-ink rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-colors duration-200 ${isLowTime ? 'bg-red' : 'bg-cyanA'}`}
                    style={{
                      width: `${Math.max(0, Math.min(100, ((timeRemaining || 0) / totalTime) * 100))}%`,
                    }}
                  />
                </div>
                <span
                  className={`font-display text-3xl font-bold tabular-nums whitespace-nowrap drop-shadow-[0_2px_0_var(--ink)] transition-colors duration-200 ${isLowTime ? 'text-red' : 'text-paper'}`}
                >
                  {displaySeconds.toFixed(1)}s
                </span>
              </div>
            </div>
          );
        })()}

        <div
          key={questionIndex}
          className="flex-1 flex flex-col items-center justify-center px-4 py-4 gap-3"
        >
          <QuestionCard
            questionText={currentQuestion.body}
            questionNumber={questionIndex}
          />

          <div className="w-full space-y-2">
            {currentQuestion.answers
              .sort((a, b) => a.sort_index - b.sort_index)
              .map((answer, i) => (
                <div key={answer.answer_id}>
                  <AnswerButton
                    text={answer.body}
                    marker={String.fromCharCode(65 + i)}
                    isSelected={selectedAnswerId === answer.answer_id}
                    feedback={selectedAnswerId === answer.answer_id ? feedback : 'idle'}
                    dimmed={selectedAnswerId !== null && selectedAnswerId !== answer.answer_id}
                    onClick={() => handleAnswerClick(answer.answer_id)}
                    disabled={isSubmitting || selectedAnswerId !== null}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
