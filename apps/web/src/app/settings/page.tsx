'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateHandle, deleteAccount } from '@/domains/profile';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { LegalFooter } from '@/components/LegalFooter';
import { validateHandle } from '@10q/contracts';
import dynamic from 'next/dynamic';
import { trackScreenView, trackSettingsView, trackHandleUpdate, trackAccountDeleted, trackAppError } from '@/lib/analytics';

// Typing this exactly is what arms the delete button.
const DELETE_CONFIRMATION_PHRASE = 'DELETE';

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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

        trackScreenView({
          screen: 'settings',
          route: '/settings',
        });

        trackSettingsView();

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
        trackAppError({
          location: 'settings_load',
          message: err instanceof Error ? err.message : 'Failed to load settings',
        });
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

        trackHandleUpdate({
          success: false,
        });
        return;
      }

      await updateHandle(handle.trim());
      setSuccess(true);
      setCurrentHandle(handle.trim());
      setHandle('');

      trackHandleUpdate({
        success: true,
      });

      // Refresh after 2 seconds
      setTimeout(() => {
        router.refresh();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update handle');
      trackAppError({
        location: 'settings_update_handle',
        message: err instanceof Error ? err.message : 'Failed to update handle',
      });
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleting) return;
    if (deleteConfirmation.trim().toUpperCase() !== DELETE_CONFIRMATION_PHRASE) {
      setDeleteError(`Type ${DELETE_CONFIRMATION_PHRASE} to confirm`);
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      // Capture before the account disappears — afterwards there's no session
      // to attribute the event to.
      trackAccountDeleted();

      await deleteAccount();

      // The server already destroyed the account; clear the now-orphaned local
      // session so the app doesn't start up holding a dead token.
      await supabase.auth.signOut();

      // Full reload rather than router.push so every cached client-side store
      // is dropped along with the session.
      window.location.href = '/';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete account';
      setDeleteError(message);
      setDeleting(false);
      trackAppError({
        location: 'settings_delete_account',
        message,
      });
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

          {/* Danger Zone — account deletion is required by both app stores */}
          <div className="mb-6 pt-6 border-t-[3px] border-ink/20">
            <h2 className="font-display text-xl font-bold text-ink mb-2">Danger Zone</h2>

            {!deleteOpen ? (
              <>
                <p className="font-body text-sm text-ink/70 mb-3">
                  Permanently delete your account and all of your data.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteOpen(true);
                    setDeleteError(null);
                  }}
                  className="w-full h-12 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
                >
                  Delete Account
                </button>
              </>
            ) : (
              <div className="p-4 bg-red/20 border-[3px] border-ink rounded-lg">
                <p className="font-body font-bold text-sm text-ink mb-2">
                  This cannot be undone.
                </p>
                <p className="font-body text-sm text-ink/80 mb-3">
                  Your handle, scores, streaks, past attempts and league memberships
                  will be permanently deleted. Leagues you own will pass to their
                  longest-standing member, or be deleted if you are the only member.
                </p>

                <label
                  htmlFor="delete-confirmation"
                  className="block font-bold text-xs uppercase tracking-wide text-ink mb-2"
                >
                  Type {DELETE_CONFIRMATION_PHRASE} to confirm
                </label>
                <input
                  id="delete-confirmation"
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => {
                    setDeleteConfirmation(e.target.value);
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                  autoComplete="off"
                  placeholder={DELETE_CONFIRMATION_PHRASE}
                  className="w-full h-12 px-4 mb-3 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-body font-bold text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-red focus:ring-offset-2 disabled:opacity-50"
                />

                {deleteError && (
                  <div className="mb-3 p-3 bg-red border-[3px] border-ink rounded-lg">
                    <p className="font-body text-sm font-bold text-ink">{deleteError}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteOpen(false);
                      setDeleteConfirmation('');
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                    className="flex-1 h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={
                      deleting ||
                      deleteConfirmation.trim().toUpperCase() !== DELETE_CONFIRMATION_PHRASE
                    }
                    className="flex-1 h-12 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleting ? 'Deleting...' : 'Delete Forever'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Back Button */}
          <button
            onClick={() => router.push('/')}
            className="w-full h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
          >
            Go Home
          </button>

          <LegalFooter />
        </div>
      </div>
    </ArcadeBackground>
  );
}

