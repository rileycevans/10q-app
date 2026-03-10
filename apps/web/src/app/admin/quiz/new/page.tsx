'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { edgeFunctions } from '@/lib/api/edge-functions';
import Link from 'next/link';

interface Answer {
  body: string;
  is_correct: boolean;
}

interface Question {
  body: string;
  answers: Answer[];
  tags: string;
}

function emptyQuestion(): Question {
  return {
    body: '',
    answers: [
      { body: '', is_correct: true },
      { body: '', is_correct: false },
      { body: '', is_correct: false },
      { body: '', is_correct: false },
    ],
    tags: '',
  };
}

export default function NewQuizPage() {
  const router = useRouter();
  const [releaseDate, setReleaseDate] = useState('');
  const [questions, setQuestions] = useState<Question[]>(
    Array.from({ length: 10 }, emptyQuestion)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedQ, setExpandedQ] = useState<number>(0);

  function updateQuestion(index: number, update: Partial<Question>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...update } : q)));
  }

  function updateAnswer(qIndex: number, aIndex: number, update: Partial<Answer>) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        const newAnswers = q.answers.map((a, j) => {
          if (j !== aIndex) return a;
          return { ...a, ...update };
        });
        return { ...q, answers: newAnswers };
      })
    );
  }

  function setCorrectAnswer(qIndex: number, aIndex: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        return {
          ...q,
          answers: q.answers.map((a, j) => ({ ...a, is_correct: j === aIndex })),
        };
      })
    );
  }

  function isValid(): boolean {
    if (!releaseDate) return false;
    return questions.every(
      (q) =>
        q.body.trim() &&
        q.answers.every((a) => a.body.trim()) &&
        q.answers.filter((a) => a.is_correct).length === 1
    );
  }

  async function handleSubmit() {
    if (!isValid() || saving) return;
    setSaving(true);
    setError(null);

    try {
      const payload = {
        release_date: releaseDate,
        questions: questions.map((q) => ({
          body: q.body.trim(),
          answers: q.answers.map((a) => ({
            body: a.body.trim(),
            is_correct: a.is_correct,
          })),
          tags: q.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        })),
      };

      const response = await edgeFunctions.createQuiz(payload);

      if (!response.ok) {
        setError(response.error?.message || 'Failed to create quiz');
        return;
      }

      router.push('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quiz');
    } finally {
      setSaving(false);
    }
  }

  const filledCount = questions.filter(
    (q) => q.body.trim() && q.answers.every((a) => a.body.trim())
  ).length;

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-display text-3xl text-ink">NEW QUIZ</h1>
            <Link
              href="/admin"
              className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink flex items-center"
            >
              Back
            </Link>
          </div>

          {/* Release Date */}
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 mb-6">
            <label className="block font-bold text-sm uppercase tracking-wide text-ink mb-2">
              Release Date
            </label>
            <input
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
              className="w-full h-12 px-4 bg-paper border-[3px] border-ink rounded-lg font-body font-bold text-base text-ink focus:outline-none focus:ring-[3px] focus:ring-cyanA"
            />
            <p className="mt-2 font-body text-xs text-ink/60">
              Quiz publishes at 11:30 UTC on this date
            </p>
          </div>

          {/* Progress */}
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm text-ink">{filledCount}/10 questions complete</span>
            </div>
            <div className="flex gap-1">
              {questions.map((q, i) => {
                const complete = q.body.trim() && q.answers.every((a) => a.body.trim());
                return (
                  <button
                    key={i}
                    onClick={() => setExpandedQ(i)}
                    className={`flex-1 h-3 rounded-full border-[2px] border-ink transition-colors ${
                      complete ? 'bg-green' : i === expandedQ ? 'bg-cyanA' : 'bg-paper'
                    }`}
                    aria-label={`Question ${i + 1}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Question Editor */}
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-bold text-ink">
                Q{expandedQ + 1}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setExpandedQ(Math.max(0, expandedQ - 1))}
                  disabled={expandedQ === 0}
                  className="w-10 h-10 bg-paper border-[3px] border-ink rounded-lg font-bold text-ink disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  onClick={() => setExpandedQ(Math.min(9, expandedQ + 1))}
                  disabled={expandedQ === 9}
                  className="w-10 h-10 bg-paper border-[3px] border-ink rounded-lg font-bold text-ink disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>

            {/* Question Body */}
            <div className="mb-4">
              <label className="block font-bold text-xs uppercase tracking-wide text-ink mb-2">
                Question
              </label>
              <textarea
                value={questions[expandedQ].body}
                onChange={(e) => updateQuestion(expandedQ, { body: e.target.value })}
                rows={3}
                placeholder="Enter question text..."
                className="w-full px-4 py-3 bg-paper border-[3px] border-ink rounded-lg font-body text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-cyanA resize-none"
              />
            </div>

            {/* Answers */}
            <div className="mb-4">
              <label className="block font-bold text-xs uppercase tracking-wide text-ink mb-2">
                Answers (select correct one)
              </label>
              <div className="space-y-2">
                {questions[expandedQ].answers.map((answer, aIdx) => (
                  <div key={aIdx} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCorrectAnswer(expandedQ, aIdx)}
                      className={`w-10 h-10 shrink-0 border-[3px] border-ink rounded-lg flex items-center justify-center font-bold text-sm transition-colors ${
                        answer.is_correct ? 'bg-green text-ink' : 'bg-paper text-ink/40'
                      }`}
                      aria-label={answer.is_correct ? 'Correct answer' : 'Mark as correct'}
                    >
                      {answer.is_correct ? '✓' : String.fromCharCode(65 + aIdx)}
                    </button>
                    <input
                      type="text"
                      value={answer.body}
                      onChange={(e) => updateAnswer(expandedQ, aIdx, { body: e.target.value })}
                      placeholder={`Answer ${String.fromCharCode(65 + aIdx)}...`}
                      className="flex-1 h-10 px-3 bg-paper border-[3px] border-ink rounded-lg font-body text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-cyanA"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block font-bold text-xs uppercase tracking-wide text-ink mb-2">
                Tags (comma separated, optional)
              </label>
              <input
                type="text"
                value={questions[expandedQ].tags}
                onChange={(e) => updateQuestion(expandedQ, { tags: e.target.value })}
                placeholder="history, science, geography..."
                className="w-full h-10 px-3 bg-paper border-[3px] border-ink rounded-lg font-body text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-cyanA"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red/20 border-[3px] border-ink rounded-lg p-4 mb-6">
              <p className="font-body text-sm font-bold text-ink">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!isValid() || saving}
            className="w-full h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] disabled:opacity-50 disabled:cursor-not-allowed mb-6"
          >
            {saving ? 'CREATING...' : 'CREATE QUIZ'}
          </button>
        </div>
      </div>
    </ArcadeBackground>
  );
}
