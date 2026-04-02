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
import { trackScreenView, trackQuestionView, trackAnswerSubmit, trackAppError } from '@/lib/analytics';

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
  const [totalTime, setTotalTime] = useState<number>(16000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback] = useState<AnswerFeedback>('idle');

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

            if (parsedAttempt.current_question_expires_at && parsedAttempt.current_question_started_at) {
              const startedAt = new Date(parsedAttempt.current_question_started_at).getTime();
              const expiresAt = new Date(parsedAttempt.current_question_expires_at).getTime();
              const duration = expiresAt - startedAt;
              setTotalTime(duration);
              setTimeRemaining(Math.max(0, expiresAt - Date.now()));
            } else if (parsedAttempt.current_question_expires_at) {
              const expiresAt = new Date(parsedAttempt.current_question_expires_at).getTime();
              const remaining = Math.max(0, expiresAt - Date.now());
              setTimeRemaining(remaining);
            } else if (parsedAttempt.current_question_started_at) {
              const startedAt = new Date(parsedAttempt.current_question_started_at).getTime();
              const elapsed = Date.now() - startedAt;
              setTimeRemaining(Math.max(0, totalTime - elapsed));
            } else {
              setTimeRemaining(totalTime);
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

        if (attemptState.state === 'READY_TO_FINALIZE') {
          router.push(`/play/finalize?attempt_id=${attemptState.attempt_id}`);
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

        if (attemptState.current_question_expires_at && attemptState.current_question_started_at) {
          const startedAt = new Date(attemptState.current_question_started_at).getTime();
          const expiresAt = new Date(attemptState.current_question_expires_at).getTime();
          const duration = expiresAt - startedAt;
          setTotalTime(duration);
          setTimeRemaining(Math.max(0, expiresAt - Date.now()));
        } else if (attemptState.current_question_expires_at) {
          const expiresAt = new Date(attemptState.current_question_expires_at).getTime();
          setTimeRemaining(Math.max(0, expiresAt - Date.now()));
        } else if (attemptState.current_question_started_at) {
          const startedAt = new Date(attemptState.current_question_started_at).getTime();
          setTimeRemaining(Math.max(0, totalTime - (Date.now() - startedAt)));
        } else {
          setTimeRemaining(totalTime);
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

  // Track question view once we have both attempt and question
  useEffect(() => {
    if (!attempt || !currentQuestion) return;

    trackScreenView({
      screen: 'question',
      route: `/play/q/${questionIndex}`,
      quiz_id: sessionStorage.getItem('quiz_id') || undefined,
      attempt_id: attempt.attempt_id,
    });

    trackQuestionView({
      quiz_id: sessionStorage.getItem('quiz_id') || currentQuestion.quiz_id,
      attempt_id: attempt.attempt_id,
      question_id: currentQuestion.question_id,
      question_index: questionIndex,
    });
  }, [attempt, currentQuestion, questionIndex]);

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
          router.push(`/play/finalize?attempt_id=${attempt.attempt_id}`);
        }
      });
    }
  }, [timeRemaining, currentQuestion, isSubmitting, attempt, router]);

  const handleAnswerClick = (answerId: string) => {
    if (!currentQuestion || !attempt || isSubmitting) return;

    setSelectedAnswerId(answerId);
    setIsSubmitting(true);

    const nextIndex = questionIndex + 1;

    // Optimistic cache: assume server will advance to next index
    const optimisticState: AttemptState = {
      attempt_id: attempt.attempt_id,
      quiz_id: attempt.quiz_id,
      current_index: nextIndex,
      current_question_started_at: new Date().toISOString(),
      current_question_expires_at: null,
      state: nextIndex <= 10 ? 'IN_PROGRESS' : 'READY_TO_FINALIZE',
    };
    sessionStorage.setItem('attempt_state', JSON.stringify(optimisticState));

    // Navigate immediately — don't wait for network
    if (nextIndex <= 10) {
      router.push(`/play/q/${nextIndex}`);
    } else {
      router.push(`/play/finalize?attempt_id=${attempt.attempt_id}`);
    }

    // Fire submit in background — updates cache when response arrives
    submitAnswer(attempt.attempt_id, currentQuestion.question_id, answerId)
      .then((result) => {
        const serverState: AttemptState = {
          attempt_id: result.attempt_id,
          quiz_id: attempt.quiz_id,
          current_index: result.current_index,
          current_question_started_at: result.question_started_at,
          current_question_expires_at: result.question_expires_at,
          state: result.current_index <= 10 ? 'IN_PROGRESS' : 'READY_TO_FINALIZE',
        };
        sessionStorage.setItem('attempt_state', JSON.stringify(serverState));

        trackAnswerSubmit({
          quiz_id: sessionStorage.getItem('quiz_id') || currentQuestion.quiz_id,
          attempt_id: result.attempt_id,
          question_id: currentQuestion.question_id,
          question_index: questionIndex,
          answer_id: answerId,
          is_correct: result.is_correct,
          time_ms: result.time_ms,
          base_points: result.base_points,
          bonus_points: result.bonus_points,
          total_points: result.total_points,
        });
      })
      .catch((err) => {
        console.error('Failed to submit answer:', err);
        trackAppError({
          location: 'question_submit',
          message: err instanceof Error ? err.message : 'Failed to submit answer',
        });
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
                    width: `${Math.max(0, Math.min(100, ((timeRemaining || 0) / totalTime) * 100))}%`,
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-base font-bold uppercase tracking-wide text-ink pointer-events-none z-10">
                  {timeRemaining !== null ? (timeRemaining / 1000).toFixed(1) : (totalTime / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          )}

          <QuestionCard
            questionText={currentQuestion.body}
            questionNumber={questionIndex}
          />

          <div className="w-full max-w-md bg-cyanA/20 border-[3px] border-ink rounded-[20px] shadow-sticker-sm p-3">
            <div className="space-y-1.5">
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

      </div>
    </ArcadeBackground>
  );
}
