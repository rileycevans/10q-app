'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAttemptResults, type AttemptResults, type QuestionResult } from '@/domains/attempt';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { QuestionCard } from '@/components/QuestionCard';
import Link from 'next/link';

function formatTime(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function QuestionResultCard({ question, index }: { question: QuestionResult; index: number }) {
  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full mb-4">
      {/* Question Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-ink rounded-full flex items-center justify-center">
            <span className="font-display text-lg font-bold text-paper">{index + 1}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {question.tags.map((tag, idx) => (
              <span
                key={idx}
                className="bg-cyanA border-[3px] border-ink rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full border-[3px] border-ink font-bold text-sm ${
          question.is_correct ? 'bg-green text-ink' : 'bg-red text-ink'
        }`}>
          {question.is_correct ? '✓ CORRECT' : '✗ WRONG'}
        </div>
      </div>

      {/* Question Prompt */}
      <p className="font-bold text-[20px] text-left leading-relaxed text-ink mb-4">
        {question.prompt}
      </p>

      {/* Answer Choices */}
      <div className="space-y-2 mb-4">
        {question.choices.map((choice) => {
          const isSelected = choice.id === question.selected_choice_id;
          const bgColor = isSelected
            ? question.is_correct
              ? 'bg-green'
              : 'bg-red'
            : 'bg-paper';
          
          return (
            <div
              key={choice.id}
              className={`
                h-12 w-full border-[3px] border-ink rounded-[14px]
                ${bgColor} flex items-center px-4
                ${isSelected ? 'font-bold' : 'font-normal'}
              `}
            >
              <span className="text-ink text-base">{choice.text}</span>
              {isSelected && (
                <span className="ml-auto text-ink font-bold">← YOUR ANSWER</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Score Breakdown */}
      <div className="border-t-[3px] border-ink pt-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-ink/80">
            <span className="font-bold">Time:</span> {formatTime(question.time_ms)}
          </div>
          {question.answer_kind === 'timeout' && (
            <div className="px-2 py-1 bg-red/20 border-[2px] border-red rounded text-xs font-bold text-ink">
              TIMEOUT
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs text-ink/80 mb-1">
            Base: {question.base_points}pt
            {question.bonus_points > 0 && ` + Bonus: ${question.bonus_points}pt`}
          </div>
          <div className="font-display text-xl font-bold text-ink">
            {question.total_points} pts
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AttemptResults | null>(null);

  useEffect(() => {
    async function loadResults() {
      try {
        const attemptId = searchParams.get('attempt_id');
        
        if (!attemptId) {
          // Try to get attempt from current quiz
          const { getCurrentQuiz } = await import('@/domains/quiz');
          const { startAttempt } = await import('@/domains/attempt');
          
          const currentQuiz = await getCurrentQuiz();
          if (!currentQuiz) {
            setError('No quiz available');
            setLoading(false);
            return;
          }

          const attemptState = await startAttempt(currentQuiz.quiz_id);
          if (attemptState.state === 'FINALIZED') {
            // Fetch results using the attempt_id
            const resultsData = await getAttemptResults(attemptState.attempt_id);
            setResults(resultsData);
          } else {
            setError('Attempt is not finalized');
          }
        } else {
          const resultsData = await getAttemptResults(attemptId);
          setResults(resultsData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
      } finally {
        setLoading(false);
      }
    }

    loadResults();
  }, [searchParams]);

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading results...</p>
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
            <h1 className="font-display text-2xl mb-4 text-ink">Error</h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            <Link
              href="/"
              className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              Go Home
            </Link>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (!results) {
    return null;
  }

  const totalTimeSeconds = (results.total_time_ms / 1000).toFixed(1);

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="w-full max-w-2xl">
          {/* Header Card */}
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 mb-6 text-center">
            <h1 className="font-display text-4xl mb-2 text-ink">QUIZ COMPLETE!</h1>
            <div className="mt-6 mb-4">
              <div className="font-display text-6xl font-bold text-ink mb-2">
                {results.total_score}
              </div>
              <div className="text-sm text-ink/80 font-bold">TOTAL POINTS</div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="bg-cyanA/20 border-[3px] border-ink rounded-[18px] p-4">
                <div className="font-display text-3xl font-bold text-ink mb-1">
                  {results.correct_count}/10
                </div>
                <div className="text-xs text-ink/80 font-bold uppercase">CORRECT</div>
              </div>
              <div className="bg-cyanA/20 border-[3px] border-ink rounded-[18px] p-4">
                <div className="font-display text-3xl font-bold text-ink mb-1">
                  {totalTimeSeconds}s
                </div>
                <div className="text-xs text-ink/80 font-bold uppercase">TOTAL TIME</div>
              </div>
            </div>
          </div>

          {/* Question Breakdown */}
          <div className="mb-6">
            <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">
              QUESTION BREAKDOWN
            </h2>
            {results.questions.map((question, index) => (
              <QuestionResultCard key={question.question_id} question={question} index={index} />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            <Link
              href="/"
              className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
            >
              PLAY AGAIN TOMORROW
            </Link>
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="h-14 w-full bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              BACK TO TOP
            </button>
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
