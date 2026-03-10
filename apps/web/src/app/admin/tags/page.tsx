'use client';

import { useEffect, useState } from 'react';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

interface TagCount {
  tag: string;
  count: number;
}

export default function TagsPage() {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTags() {
      const { data, error } = await supabase
        .from('question_tags')
        .select('tag');

      if (error) {
        console.error('Failed to load tags:', error);
        setLoading(false);
        return;
      }

      const counts = new Map<string, number>();
      for (const row of data || []) {
        counts.set(row.tag, (counts.get(row.tag) || 0) + 1);
      }

      const sorted = Array.from(counts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);

      setTags(sorted);
      setLoading(false);
    }

    loadTags();
  }, []);

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-display text-3xl text-ink">TAGS</h1>
            <Link
              href="/admin"
              className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink flex items-center"
            >
              Back
            </Link>
          </div>

          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6">
            {loading ? (
              <p className="font-body text-sm text-ink/60">Loading tags...</p>
            ) : tags.length === 0 ? (
              <p className="font-body text-sm text-ink/60">No tags found. Tags will appear here when questions are tagged.</p>
            ) : (
              <>
                <p className="font-body text-sm text-ink/60 mb-4">
                  {tags.length} unique tags across all questions
                </p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <span
                      key={t.tag}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-yellow border-[3px] border-ink rounded-lg font-body text-sm font-bold text-ink"
                    >
                      {t.tag}
                      <span className="text-xs text-ink/60 ml-1">({t.count})</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
