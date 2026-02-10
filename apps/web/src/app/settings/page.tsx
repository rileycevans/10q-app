'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateHandle } from '@/domains/profile';
import { getSession } from '@/lib/auth';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { validateHandle } from '@10q/contracts';
import dynamic from 'next/dynamic';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function SettingsPage() {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  const [daysUntilChange, setDaysUntilChange] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      if (!mounted) return;

      try {
        setLoading(true);
        setError(null);

        const session = await getSession();
        if (!session) {
          setError('Please sign in to view settings');
          setLoading(false);
          return;
        }

        // Get current player to fetch handle and last changed date (Notion plan: players table)
        const { data: player, error: playerError } = await supabase
          .from('players')
          .select('handle_display, handle_last_changed_at')
          .eq('id', session.user.id)
          .single();

        if (playerError || !player) {
          setError('Failed to load player profile');
          setLoading(false);
          return;
        }

        setCurrentHandle(player.handle_display);

        // Calculate days until next change
        if (player.handle_last_changed_at) {
          const lastChanged = new Date(player.handle_last_changed_at);
          const now = new Date();
          const daysSinceChange = (now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24);
          const daysRemaining = Math.max(0, Math.ceil(30 - daysSinceChange));
          setDaysUntilChange(daysRemaining);
        } else {
          setDaysUntilChange(0); // Can change immediately
        }

        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setLoading(false);
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || updating) return;

    setUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate handle format
      const validation = validateHandle(handle.trim());
      if (!validation.valid) {
        setError(validation.error || 'Invalid handle');
        setUpdating(false);
        return;
      }

      await updateHandle(handle.trim());
      setSuccess(true);
      setCurrentHandle(handle.trim());
      setHandle('');

      // Refresh after 2 seconds
      setTimeout(() => {
        router.refresh();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update handle');
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading Settings...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (error && error.includes('sign in')) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="absolute top-4 left-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">Sign In Required</h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              Go Home
            </button>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>

        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-md">
          <h1 className="font-display text-3xl mb-6 text-ink text-center">Settings</h1>

          {/* Handle Customization */}
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-ink mb-4">Customize Handle</h2>

            {currentHandle && (
              <div className="mb-4 p-3 bg-cyanA border-[3px] border-ink rounded-lg">
                <p className="font-body text-sm text-ink/80 mb-1">Current Handle:</p>
                <p className="font-body font-bold text-base text-ink">{currentHandle}</p>
              </div>
            )}

            {daysUntilChange !== null && daysUntilChange > 0 && (
              <div className="mb-4 p-3 bg-yellow border-[3px] border-ink rounded-lg">
                <p className="font-body text-sm font-bold text-ink">
                  Handle can be changed in {daysUntilChange} day(s)
                </p>
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 bg-green border-[3px] border-ink rounded-lg">
                <p className="font-body text-sm font-bold text-ink">
                  Handle updated successfully!
                </p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red border-[3px] border-ink rounded-lg">
                <p className="font-body text-sm font-bold text-ink">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block font-bold text-sm uppercase tracking-wide text-ink mb-2">
                  New Handle
                </label>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    setError(null);
                    setSuccess(false);
                  }}
                  placeholder="Enter new handle (3-20 chars)"
                  maxLength={20}
                  disabled={updating || (daysUntilChange !== null && daysUntilChange > 0)}
                  className="w-full h-12 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-body font-bold text-base text-ink placeholder:text-ink/50 focus:outline-none focus:ring-[3px] focus:ring-cyanA focus:ring-offset-2 disabled:opacity-50"
                />
                <p className="mt-2 font-body text-xs text-ink/60">
                  Must start with a letter, 3-20 characters, letters and numbers only
                </p>
              </div>

              <button
                type="submit"
                disabled={!handle.trim() || updating || (daysUntilChange !== null && daysUntilChange > 0)}
                className="w-full h-12 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? 'Updating...' : 'Update Handle'}
              </button>
            </form>
          </div>

          {/* Back Button */}
          <button
            onClick={() => router.push('/')}
            className="w-full h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
          >
            Go Home
          </button>
        </div>
      </div>
    </ArcadeBackground>
  );
}

