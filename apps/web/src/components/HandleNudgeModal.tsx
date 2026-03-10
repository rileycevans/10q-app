'use client';

import { useState } from 'react';
import { validateHandle } from '@10q/contracts';
import { updateHandle } from '@/domains/profile';

interface HandleNudgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (handle: string) => void;
}

export function HandleNudgeModal({ isOpen, onClose, onSaved }: HandleNudgeModalProps) {
  const [handle, setHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const validation = handle.trim() ? validateHandle(handle.trim()) : null;
  const canSubmit = validation?.valid && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      await updateHandle(handle.trim());
      onSaved(handle.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save handle');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-ink hover:bg-ink/10 rounded-full font-bold"
          aria-label="Dismiss"
        >
          ✕
        </button>

        <h2 className="font-display text-2xl font-bold text-ink mb-2 text-center">
          Nice work!
        </h2>
        <p className="font-body text-sm text-ink/70 text-center mb-6">
          Save your score with a username so friends can find you on the leaderboard.
        </p>

        <div className="mb-4">
          <input
            type="text"
            value={handle}
            onChange={(e) => { setHandle(e.target.value); setError(null); }}
            placeholder="Pick a username..."
            maxLength={20}
            className="w-full h-12 px-4 bg-paper border-[3px] border-ink rounded-lg font-body font-bold text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-[3px] focus:ring-cyanA"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
          {handle.trim() && validation && !validation.valid && (
            <p className="mt-2 text-xs font-bold text-red">{validation.error}</p>
          )}
          {error && (
            <p className="mt-2 text-xs font-bold text-red">{error}</p>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'SAVING...' : 'SAVE USERNAME'}
        </button>

        <button
          onClick={onClose}
          className="w-full mt-3 text-sm font-bold text-ink/50 hover:text-ink/80 transition-colors text-center py-2"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
