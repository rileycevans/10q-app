'use client';

import { useState } from 'react';

interface AddMemberFormProps {
  onAdd: (handle: string) => Promise<void>;
  disabled?: boolean;
}

export function AddMemberForm({ onAdd, disabled }: AddMemberFormProps) {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || loading || disabled) return;

    setLoading(true);
    setError(null);

    try {
      await onAdd(handle.trim());
      setHandle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setError(null);
          }}
          placeholder="Enter player handle"
          disabled={loading || disabled}
          className="flex-1 h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-body font-bold text-sm text-ink placeholder:text-ink/50 focus:outline-none focus:ring-[3px] focus:ring-cyanA focus:ring-offset-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!handle.trim() || loading || disabled}
          className="h-10 px-6 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-red font-bold">{error}</p>
      )}
    </form>
  );
}

