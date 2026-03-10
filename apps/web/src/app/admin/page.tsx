'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { supabase } from '@/lib/supabase/client';

interface QuizSummary {
  id: string;
  quiz_number: number | null;
  status: string;
  release_at_utc: string;
}

export default function AdminPage() {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [stats, setStats] = useState({ total: 0, published: 0, scheduled: 0, draft: 0 });

  useEffect(() => {
    async function load() {
      const { data, count } = await supabase
        .from('quizzes')
        .select('id, quiz_number, status, release_at_utc', { count: 'exact' })
        .order('release_at_utc', { ascending: false })
        .limit(10);

      if (data) setQuizzes(data);

      const { count: published } = await supabase
        .from('quizzes').select('*', { count: 'exact', head: true }).eq('status', 'published');
      const { count: scheduled } = await supabase
        .from('quizzes').select('*', { count: 'exact', head: true }).eq('status', 'scheduled');
      const { count: draft } = await supabase
        .from('quizzes').select('*', { count: 'exact', head: true }).eq('status', 'draft');

      setStats({
        total: count ?? 0,
        published: published ?? 0,
        scheduled: scheduled ?? 0,
        draft: draft ?? 0,
      });
    }
    load();
  }, []);

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-display text-4xl text-ink">ADMIN</h1>
            <Link
              href="/"
              className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink flex items-center"
            >
              Home
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total', value: stats.total, bg: 'bg-paper' },
              { label: 'Published', value: stats.published, bg: 'bg-green' },
              { label: 'Scheduled', value: stats.scheduled, bg: 'bg-yellow' },
              { label: 'Draft', value: stats.draft, bg: 'bg-cyanA' },
            ].map((s) => (
              <div key={s.label} className={`${s.bg} border-[3px] border-ink rounded-lg p-3 text-center`}>
                <p className="font-display text-2xl font-bold text-ink">{s.value}</p>
                <p className="font-body text-xs text-ink/80 uppercase font-bold">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Link
              href="/admin/quiz/new"
              className="h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              + NEW QUIZ
            </Link>
            <Link
              href="/admin/tags"
              className="h-14 bg-yellow border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              TAGS
            </Link>
          </div>

          {/* Recent Quizzes */}
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6">
            <h2 className="font-display text-xl font-bold text-ink mb-4">Recent Quizzes</h2>
            {quizzes.length === 0 ? (
              <p className="font-body text-sm text-ink/60">No quizzes yet.</p>
            ) : (
              <div className="space-y-2">
                {quizzes.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-center justify-between py-3 px-4 border-[3px] border-ink rounded-lg"
                  >
                    <div>
                      <span className="font-display text-sm font-bold text-ink">
                        {q.quiz_number != null ? `#${q.quiz_number}` : '—'}
                      </span>
                      <span className="ml-2 font-body text-xs text-ink/60">
                        {new Date(q.release_at_utc).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded border-[2px] border-ink ${
                      q.status === 'published' ? 'bg-green' :
                      q.status === 'scheduled' ? 'bg-yellow' :
                      'bg-cyanA'
                    }`}>
                      {q.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
