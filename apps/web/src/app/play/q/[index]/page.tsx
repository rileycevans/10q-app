'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentQuiz, getQuizQuestions } from '@/domains/quiz';
import { resumeAttempt, submitAnswer } from '@/domains/attempt';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { HUD } from '@/components/HUD';
import { QuestionCard } from '@/components/QuestionCard';
import { AnswerButton } from '@/components/AnswerButton';
import type { AnswerFeedback } from '@/components/AnswerButton';
import type { QuizQuestion } from '@/domains/quiz';
import type { AttemptState } from '@/domains/attempt';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const questionIndex = parseInt(params.index as string, 10);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_quizId, setQuizId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [_questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<AnswerFeedback>('idle');

  useEffect(() => {
    // Prefetch next question route for instant navigation
    if (questionIndex < 10) {
      router.prefetch(`/play/q/${questionIndex + 1}`);
    } else if (questionIndex === 10) {
      router.prefetch('/play/finalize');
    }

    // Check cache synchronously first - if we have everything, skip loading screen
    const cachedQuestions = sessionStorage.getItem('quiz_questions');
    const cachedAttempt = sessionStorage.getItem('attempt_state');
    const cachedQuizId = sessionStorage.getItem('quiz_id');

    if (cachedQuestions && cachedAttempt && cachedQuizId) {
      try {
        const parsedAttempt = JSON.parse(cachedAttempt);
        // If cache matches current index, we can render immediately
        if (parsedAttempt.current_index === questionIndex) {
          const parsedQuestions = JSON.parse(cachedQuestions);
          const question = parsedQuestions.find((q: QuizQuestion) => q.order_index === questionIndex);
          if (question) {
            // We have everything cached - render immediately
            setQuestions(parsedQuestions);
            setAttempt(parsedAttempt);
            setCurrentQuestion(question);
            setQuizId(cachedQuizId);
            setLoading(false);

            // Calculate time remaining
            if (parsedAttempt.current_question_expires_at) {
              const expiresAt = new Date(parsedAttempt.current_question_expires_at).getTime();
              const now = Date.now();
              const remaining = Math.max(0, expiresAt - now);
              setTimeRemaining(remaining);
            } else if (parsedAttempt.current_question_started_at) {
              const startedAt = new Date(parsedAttempt.current_question_started_at).getTime();
              const now = Date.now();
              const elapsed = now - startedAt;
              const remaining = Math.max(0, 16000 - elapsed);
              setTimeRemaining(remaining);
            } else {
              setTimeRemaining(16000);
            }

            // Still validate in background, but don't block UI
            initialize();
            return;
          }
        }
      } catch {
        // Invalid cache, continue with normal initialization
      }
    }

    async function initialize() {
      try {
        let quizQuestions: QuizQuestion[] = [];
        let attemptState: AttemptState | null = null;

        // Get current quiz (always needed)
        const currentQuiz = await getCurrentQuiz();
        if (!currentQuiz) {
          setError('No quiz available');
          setLoading(false);
          return;
        }

        const currentQuizId = currentQuiz.quiz_id;
        setQuizId(currentQuizId);

        // Use cached questions if available and quiz ID matches
        if (cachedQuestions && cachedQuizId === currentQuizId) {
          try {
            quizQuestions = JSON.parse(cachedQuestions);
            setQuestions(quizQuestions);
          } catch {
            // Invalid cache, fetch fresh
            quizQuestions = await getQuizQuestions(currentQuizId);
            setQuestions(quizQuestions);
            sessionStorage.setItem('quiz_questions', JSON.stringify(quizQuestions));
            sessionStorage.setItem('quiz_id', currentQuizId);
          }
        } else {
          // Fetch questions and cache them
          quizQuestions = await getQuizQuestions(currentQuizId);
          setQuestions(quizQuestions);
          sessionStorage.setItem('quiz_questions', JSON.stringify(quizQuestions));
          sessionStorage.setItem('quiz_id', currentQuizId);
        }

        // Use cached attempt state if available and matches current index (allow optimistic ahead-by-1)
        if (cachedAttempt) {
          try {
            const parsed = JSON.parse(cachedAttempt);
            // Use cache if it matches requested index, or is 1 ahead (optimistic navigation), or 1 behind (catching up)
            if (parsed.current_index === questionIndex ||
              parsed.current_index === questionIndex - 1 ||
              parsed.current_index === questionIndex + 1) {
              attemptState = parsed;
              setAttempt(attemptState);
            }
          } catch {
            // Invalid cache, fetch fresh
          }
        }

        // Fetch fresh attempt state if not cached or cache doesn't match
        if (!attemptState) {
          const { startAttempt } = await import('@/domains/attempt');
          attemptState = await startAttempt(currentQuizId);
          setAttempt(attemptState);
          sessionStorage.setItem('attempt_state', JSON.stringify(attemptState));
        }

        // Check if requested index matches server index
        if (attemptState.current_index !== questionIndex) {
          // Redirect to correct index
          router.push(`/play/q/${attemptState.current_index}`);
          return;
        }

        // If attempt is finalized, go to results
        if (attemptState.state === 'FINALIZED') {
          router.push('/results');
          return;
        }

        // If ready to finalize, go to finalize page
        if (attemptState.state === 'READY_TO_FINALIZE') {
          router.push('/play/finalize');
          return;
        }

        // Get current question
        const question = quizQuestions.find(q => q.order_index === questionIndex);
        if (!question) {
          setError('Question not found');
          setLoading(false);
          return;
        }

        setCurrentQuestion(question);

        // Calculate time remaining
        if (attemptState.current_question_expires_at) {
          const expiresAt = new Date(attemptState.current_question_expires_at).getTime();
          const now = Date.now();
          const remaining = Math.max(0, expiresAt - now);
          setTimeRemaining(remaining);
        } else if (attemptState.current_question_started_at) {
          // Fallback: calculate from start time if expires_at is missing
          const startedAt = new Date(attemptState.current_question_started_at).getTime();
          const now = Date.now();
          const elapsed = now - startedAt;
          const remaining = Math.max(0, 16000 - elapsed);
          setTimeRemaining(remaining);
        } else {
          // Default to full time if nothing is set
          setTimeRemaining(16000);
        }

        // If we got here with cached data, we can skip the loading screen
        // Otherwise it will show briefly while data loads
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load question');
        setLoading(false);
      }
    }

    initialize();
  }, [questionIndex, router]);

  // Update timer (stop when submitting)
  useEffect(() => {
    if (!timeRemaining || timeRemaining <= 0 || isSubmitting) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (!prev || prev <= 0 || isSubmitting) {
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeRemaining, isSubmitting]);

  // Auto-advance on timeout — no animation, just move on
  useEffect(() => {
    if (timeRemaining === 0 && currentQuestion && !isSubmitting && attempt) {
      setIsSubmitting(true); // prevent double-fire

      // Resume to handle timeout and get next question — no visual feedback
      resumeAttempt(attempt.attempt_id).then((newAttempt) => {
        sessionStorage.setItem('attempt_state', JSON.stringify(newAttempt));
        setAttempt(newAttempt);
        if (newAttempt.current_index <= 10) {
          router.push(`/play/q/${newAttempt.current_index}`);
        } else {
          router.push('/play/finalize');
        }
      });
    }
  }, [timeRemaining, currentQuestion, isSubmitting, attempt, router]);

  const handleAnswerClick = async (answerId: string) => {
    if (!currentQuestion || !attempt || isSubmitting) return;

    // 1. Highlight selected answer & freeze the clock
    setSelectedAnswerId(answerId);
    setIsSubmitting(true);

    try {
      // 2. Await the server response to know correct/wrong
      const result = await submitAnswer(attempt.attempt_id, currentQuestion.question_id, answerId);

      // 3. Show feedback animation (green pop or red shake)
      setFeedback(result.is_correct ? 'correct' : 'wrong');

      // 4. Build next state for cache
      const nextState: AttemptState = {
        attempt_id: result.attempt_id,
        quiz_id: attempt.quiz_id,
        current_index: result.current_index,
        current_question_started_at: result.question_started_at,
        current_question_expires_at: result.question_expires_at,
        state: result.current_index <= 10 ? 'IN_PROGRESS' : 'READY_TO_FINALIZE',
      };
      sessionStorage.setItem('attempt_state', JSON.stringify(nextState));

      // 5. Wait 1 second so the player can see the feedback
      await sleep(1000);

      // 6. Auto-advance to next question
      if (result.current_index <= 10) {
        router.push(`/play/q/${result.current_index}`);
      } else {
        router.push('/play/finalize');
      }
    } catch (err) {
      console.error('Failed to submit answer:', err);
      // On network error, still try to advance using optimistic state
      const nextIndex = questionIndex + 1;
      if (nextIndex <= 10) {
        router.push(`/play/q/${nextIndex}`);
      } else {
        router.push('/play/finalize');
      }
    }
  };

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

  if (!currentQuestion || !attempt) {
    return null;
  }

  return (
    <ArcadeBackground>
      <div className="flex flex-col min-h-screen relative">
        <HUD
          progress={questionIndex}
        />

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4">
          {/* Time Remaining Progress Bar — stays visible but frozen when submitting */}
          {currentQuestion && attempt && (
            <div className="w-full max-w-md px-4 mb-2">
              <div className="w-full h-10 bg-paper border-[4px] border-ink rounded-full shadow-sticker overflow-hidden relative">
                <div
                  className="h-full bg-cyanA transition-all duration-100 ease-linear"
                  style={{
                    width: `${Math.max(0, Math.min(100, ((timeRemaining || 0) / 16000) * 100))}%`,
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-base font-bold uppercase tracking-wide text-ink pointer-events-none z-10">
                  {timeRemaining !== null ? (timeRemaining / 1000).toFixed(1) : '16.0'}s
                </span>
              </div>
            </div>
          )}

          <QuestionCard
            questionText={currentQuestion.body}
            questionNumber={questionIndex}
          />

          <div className="w-full max-w-md space-y-1.5">
            {currentQuestion.answers
              .sort((a, b) => a.sort_index - b.sort_index)
              .map((answer) => (
                <AnswerButton
                  key={answer.answer_id}
                  text={answer.body}
                  isSelected={selectedAnswerId === answer.answer_id}
                  feedback={selectedAnswerId === answer.answer_id ? feedback : 'idle'}
                  onClick={() => handleAnswerClick(answer.answer_id)}
                  disabled={isSubmitting || selectedAnswerId !== null}
                />
              ))}
          </div>
        </div>

      </div>
    </ArcadeBackground>
  );
}
