'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentQuiz, getQuizQuestions } from '@/domains/quiz';
import { resumeAttempt, submitAnswer } from '@/domains/attempt';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { HUD } from '@/components/HUD';
import { QuestionCard } from '@/components/QuestionCard';
import { AnswerButton } from '@/components/AnswerButton';
import type { QuizQuestion } from '@/domains/quiz';
import type { AttemptState } from '@/domains/attempt';

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const questionIndex = parseInt(params.index as string, 10);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        let currentQuizId: string;

        // Get current quiz (always needed)
        const currentQuiz = await getCurrentQuiz();
        if (!currentQuiz) {
          setError('No quiz available');
          setLoading(false);
          return;
        }

        currentQuizId = currentQuiz.quiz_id;
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
          // Timeout - auto-advance will happen on next resume
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeRemaining, isSubmitting]);

  // Auto-advance on timeout
  useEffect(() => {
    if (timeRemaining === 0 && currentQuestion && !isSubmitting && attempt) {
      // Resume to handle timeout and get next question
      resumeAttempt(attempt.attempt_id).then((newAttempt) => {
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

    setSelectedAnswerId(answerId);
    setIsSubmitting(true);
    // Stop timer immediately when answer is clicked
    setTimeRemaining(null);

    // Calculate next index optimistically
    const nextIndex = questionIndex + 1;
    const nextState: AttemptState = {
      attempt_id: attempt.attempt_id,
      quiz_id: attempt.quiz_id,
      current_index: nextIndex,
      current_question_started_at: new Date().toISOString(),
      current_question_expires_at: new Date(Date.now() + 16000).toISOString(),
      state: nextIndex <= 10 ? 'IN_PROGRESS' : 'READY_TO_FINALIZE',
    };

    // Update cache optimistically for instant navigation
    sessionStorage.setItem('attempt_state', JSON.stringify(nextState));

    // Navigate immediately (questions are already cached, so this is instant)
    if (nextIndex <= 10) {
      router.push(`/play/q/${nextIndex}`);
    } else {
      router.push('/play/finalize');
    }

    // Submit answer in the background (don't await - let it complete async)
    submitAnswer(attempt.attempt_id, currentQuestion.question_id, answerId)
      .then((result) => {
        // Update cache with actual server response (corrects any timing issues)
        const actualState: AttemptState = {
          attempt_id: result.attempt_id,
          quiz_id: attempt.quiz_id,
          current_index: result.current_index,
          current_question_started_at: result.question_started_at,
          current_question_expires_at: result.question_expires_at,
          state: result.current_index <= 10 ? 'IN_PROGRESS' : 'READY_TO_FINALIZE',
        };
        sessionStorage.setItem('attempt_state', JSON.stringify(actualState));

        // If server says we're on a different index, redirect to correct one
        if (result.current_index !== nextIndex) {
          if (result.current_index <= 10) {
            router.push(`/play/q/${result.current_index}`);
          } else {
            router.push('/play/finalize');
          }
        }
      })
      .catch((err) => {
        // Log error but don't block UI - server will correct on next page load
        console.error('Failed to submit answer:', err);
        // The next page will detect the mismatch and redirect if needed
      });
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

  const totalScore = 0; // TODO: Calculate from attempt answers

  return (
    <ArcadeBackground>
      <div className="flex flex-col min-h-screen relative">
        <HUD
          progress={questionIndex}
        />

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4">
          {/* Time Remaining Progress Bar */}
          {currentQuestion && attempt && !isSubmitting && (
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

