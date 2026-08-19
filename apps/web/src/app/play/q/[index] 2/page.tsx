'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCurrentQuiz, getQuizQuestions } from '@/domains/quiz';
import { resumeAttempt, submitAnswer } from '@/domains/attempt';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { HUD } from '@/components/HUD';
import { QuestionCard } from '@/components/QuestionCard';
import { AnswerButton } from '@/components/AnswerButton';
import { BottomDock } from '@/components/BottomDock';
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
  const [answerFeedback, setAnswerFeedback] = useState<{ isCorrect: boolean; points: number } | null>(null);

  useEffect(() => {
    async function initialize() {
      try {
        // Get current quiz
        const currentQuiz = await getCurrentQuiz();
        if (!currentQuiz) {
          setError('No quiz available');
          setLoading(false);
          return;
        }

        setQuizId(currentQuiz.quiz_id);

        // Get quiz questions
        const quizQuestions = await getQuizQuestions(currentQuiz.quiz_id);
        setQuestions(quizQuestions);

        // Resume attempt to get current state (handles expiry automatically)
        const { startAttempt } = await import('@/domains/attempt');
        const attemptState = await startAttempt(currentQuiz.quiz_id);
        setAttempt(attemptState);

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
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load question');
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [questionIndex, router]);

  // Update timer
  useEffect(() => {
    if (!timeRemaining || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (!prev || prev <= 0) {
          // Timeout - auto-advance will happen on next resume
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [timeRemaining]);

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

    try {
      const result = await submitAnswer(attempt.attempt_id, currentQuestion.question_id, answerId);

      // Show feedback
      setAnswerFeedback({
        isCorrect: result.is_correct,
        points: result.total_points,
      });

      // Advance after brief delay
      setTimeout(() => {
        if (result.next_index <= 10) {
          router.push(`/play/q/${result.next_index}`);
        } else {
          router.push('/play/finalize');
        }
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
      setIsSubmitting(false);
      setSelectedAnswerId(null);
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

  const tags = currentQuestion.tags || [];
  const totalScore = 0; // TODO: Calculate from attempt answers

  return (
    <ArcadeBackground>
      <div className="flex flex-col min-h-screen">
        <HUD
          progress={questionIndex}
          timeRemaining={timeRemaining || undefined}
          category={tags[0]}
          score={totalScore}
        />

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-6">
          <QuestionCard
            questionText={currentQuestion.body}
            questionNumber={questionIndex}
            tags={tags}
          />

          {answerFeedback && (
            <div className={`bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-4 ${
              answerFeedback.isCorrect ? 'bg-green' : 'bg-red'
            }`}>
              <p className="font-bold text-lg text-ink text-center">
                {answerFeedback.isCorrect ? '✓ Correct!' : '✗ Incorrect'}
              </p>
              <p className="font-body text-sm text-ink text-center">
                +{answerFeedback.points} points
              </p>
            </div>
          )}

          <div className="w-full max-w-md space-y-3">
            {currentQuestion.answers
              .sort((a, b) => a.sort_index - b.sort_index)
              .map((answer) => (
                <AnswerButton
                  key={answer.answer_id}
                  text={answer.body}
                  isSelected={selectedAnswerId === answer.answer_id}
                  isCorrect={answerFeedback ? answerFeedback.isCorrect : null}
                  onClick={() => handleAnswerClick(answer.answer_id)}
                  disabled={isSubmitting || selectedAnswerId !== null}
                />
              ))}
          </div>
        </div>

        <BottomDock />
      </div>
    </ArcadeBackground>
  );
}

