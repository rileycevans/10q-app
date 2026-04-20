'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore, useGameState } from '@/components/GameProvider';
import { submitAnswer, resumeAttempt } from '@/domains/attempt';
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

  // ── Initialize timer from attempt state ─────────────────────────────────
  useEffect(() => {
    if (!attempt) return;

    const attemptId = attempt.attempt_id;

    // Start the server-side timer when question loads
    async function startTimer() {
      try {
        const { edgeFunctions } = await import('@/lib/api/edge-functions');
        await edgeFunctions.startQuestionTimer(attemptId);

        // Set client timer to 12 seconds
        setTimeRemaining(12000);
        setTotalTime(12000);
      } catch (error) {
        console.error('Failed to start timer:', error);
        // Fall back to 12 seconds anyway
        setTimeRemaining(12000);
        setTotalTime(12000);
      }
    }

    startTimer();
  }, [attempt, questionIndex]);

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

  // ── Tick timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timeRemaining || timeRemaining <= 0 || isSubmitting) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (!prev || prev <= 0 || isSubmitting) return 0;
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeRemaining, isSubmitting]);

  // ── Auto-advance on timeout ─────────────────────────────────────────────
  useEffect(() => {
    if (timeRemaining !== null && timeRemaining <= 0 && currentQuestion && !isSubmitting && attempt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSubmitting(true);

      // Submit timeout answer - pick first answer (backend will detect timeout and mark as timeout)
      const firstAnswerId = currentQuestion.answers[0]?.answer_id;
      if (!firstAnswerId) {
        // No answers available, skip to next question
        resumeAttempt(attempt.attempt_id).then((newAttempt) => {
          store.setAttempt(newAttempt);
          if (newAttempt.current_index <= 10) {
            router.push(`/play/q/${newAttempt.current_index}`);
          } else {
            router.push(`/results?attempt_id=${attempt.attempt_id}`);
          }
        });
        return;
      }

      submitAnswer(attempt.attempt_id, currentQuestion.question_id, firstAnswerId)
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

          const newAttempt: AttemptState = {
            attempt_id: result.attempt_id,
            quiz_id: attempt.quiz_id,
            current_index: result.current_index,
            current_question_started_at: result.question_started_at,
            current_question_expires_at: result.question_expires_at,
            state: result.current_index > 10 ? 'READY_TO_FINALIZE' : 'IN_PROGRESS',
          };

          store.setAttempt(newAttempt);
          if (result.current_index <= 10) {
            router.push(`/play/q/${result.current_index}`);
          } else {
            router.push(`/results?attempt_id=${attempt.attempt_id}`);
          }
        })
        .catch((err) => {
          trackAppError({
            location: 'timeout_submit',
            message: err instanceof Error ? err.message : 'Failed to submit timeout answer',
          });
          // Fallback to resume
          resumeAttempt(attempt.attempt_id).then((newAttempt) => {
            store.setAttempt(newAttempt);
            if (newAttempt.current_index <= 10) {
              router.push(`/play/q/${newAttempt.current_index}`);
            } else {
              router.push(`/results?attempt_id=${attempt.attempt_id}`);
            }
          });
        });
    }
  }, [timeRemaining, currentQuestion, isSubmitting, attempt, router, store, game.quizId, questionIndex, totalTime]);

  // ── Answer handler ──────────────────────────────────────────────────────
  const handleAnswerClick = async (answerId: string) => {
    if (!currentQuestion || !attempt || isSubmitting) return;

    setSelectedAnswerId(answerId);
    setIsSubmitting(true);
    setFeedback('committed');

    const nextIndex = questionIndex + 1;
    const isLastQuestion = nextIndex > 10;

    try {
      const result = await submitAnswer(attempt.attempt_id, currentQuestion.question_id, answerId);

      // Build the next attempt state but DON'T store it yet —
      // updating the store changes current_index which triggers the
      // redirect useEffect, cutting the reveal animation short.
      const serverState: AttemptState = {
        attempt_id: result.attempt_id,
        quiz_id: attempt.quiz_id,
        current_index: result.current_index,
        current_question_started_at: result.question_started_at,
        current_question_expires_at: result.question_expires_at,
        state: result.current_index <= 10 ? 'IN_PROGRESS' : 'READY_TO_FINALIZE',
      };

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

      // Update the store and navigate immediately
      store.setAttempt(serverState);

      if (isLastQuestion) {
        router.push(`/results?attempt_id=${attempt.attempt_id}`);
      } else {
        router.push(`/play/q/${nextIndex}`);
      }
    } catch (err) {
      console.error('Failed to submit answer:', err);
      trackAppError({
        location: 'question_submit',
        message: err instanceof Error ? err.message : 'Failed to submit answer',
      });
      if (isLastQuestion) {
        router.push(`/results?attempt_id=${attempt.attempt_id}`);
      } else {
        router.push(`/play/q/${nextIndex}`);
      }
    }
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
        <div className="flex items-center gap-3 w-full px-4 py-2">
          <HUD progress={questionIndex} />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex-1 h-3 bg-paper/40 border-[2px] border-ink rounded-full overflow-hidden">
              <div
                className="h-full bg-cyanA transition-all duration-100 ease-linear rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, ((timeRemaining || 0) / totalTime) * 100))}%`,
                }}
              />
            </div>
            <span className="text-xs font-bold text-paper tabular-nums whitespace-nowrap">
              {timeRemaining !== null ? (timeRemaining / 1000).toFixed(1) : (totalTime / 1000).toFixed(1)}s
            </span>
          </div>
        </div>

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
