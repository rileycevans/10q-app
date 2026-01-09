'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLeague } from '@/domains/league';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function CreateLeaguePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const league = await createLeague(name.trim());
      router.push(`/leagues/${league.league_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create league');
      setLoading(false);
    }
  }

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>

        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-md">
          <h1 className="font-display text-3xl mb-6 text-ink text-center">Create League</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-bold text-sm uppercase tracking-wide text-ink mb-2">
                League Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="Enter league name"
                maxLength={100}
                disabled={loading}
                className="w-full h-12 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-body font-bold text-base text-ink placeholder:text-ink/50 focus:outline-none focus:ring-[3px] focus:ring-cyanA focus:ring-offset-2 disabled:opacity-50"
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red border-[3px] border-ink rounded-lg p-3">
                <p className="font-body text-sm font-bold text-ink">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.push('/leagues')}
                disabled={loading}
                className="flex-1 h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || loading}
                className="flex-1 h-12 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating...' : 'Create League'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ArcadeBackground>
  );
}

