'use client';

import { useCallback, useEffect, useState } from 'react';
import { push, appInfo } from '@/platform';
import { useModalA11y } from './useModalA11y';
import { trackAppError } from '@/lib/analytics';

/**
 * Asks for notification permission, once, at the right moment.
 *
 * The OS prompt can only be shown once — decline it and iOS never asks
 * again, the player has to find it in Settings. So the timing matters more
 * than the copy: asking on launch, before anyone knows what the app is,
 * spends the single attempt on a stranger.
 *
 * This asks after a first completed quiz, when the value proposition is
 * concrete: they have played, they can see a streak worth keeping, and
 * "remind me tomorrow" means something.
 *
 * The in-app dialog exists so a "not now" costs nothing — declining ours
 * leaves the OS prompt unspent for another day, while declining the OS one
 * is permanent.
 */

const ASKED_KEY = 'push_primer_shown';

export function PushPrimer({ show }: { show: boolean }) {
  const [open, setOpen] = useState(false);

  // Declared before useModalA11y captures it. As a plain function below, the
  // hook would close over the first render's binding and Escape would call a
  // stale one.
  const dismiss = useCallback(() => {
    // Remember either way: someone who said no should not be asked after
    // every quiz. The OS prompt is still unspent if they change their mind
    // in Settings.
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      /* private mode — worst case they see this again */
    }
    setOpen(false);
  }, []);

  const dialogRef = useModalA11y(open, dismiss);

  useEffect(() => {
    if (!show) return;
    if (!appInfo.isNative) return; // web push is not implemented

    let cancelled = false;

    (async () => {
      try {
        if (localStorage.getItem(ASKED_KEY)) return;

        // Already answered at the OS level — nothing to prime.
        const current = await push.checkPermission();
        if (cancelled || current !== 'prompt') return;

        setOpen(true);
      } catch {
        // Never block the results screen on this.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [show]);

  async function enable() {
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);

    try {
      await push.requestPermissionAndRegister();
    } catch (err) {
      trackAppError({
        location: 'push_primer_enable',
        message: err instanceof Error ? err.message : 'Failed to register for push',
      });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={dismiss} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-primer-title"
        tabIndex={-1}
        className="relative bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="push-primer-title"
          className="font-display text-2xl font-bold text-ink mb-3 text-center uppercase tracking-wide"
        >
          Don&apos;t miss tomorrow
        </h2>
        <p className="font-body text-sm text-ink/80 mb-6 text-center">
          A new quiz drops every day at 11:30 UTC. We can remind you — and give
          you a nudge if your streak is about to break.
        </p>

        <button
          type="button"
          onClick={enable}
          className="w-full h-12 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-base text-ink mb-3 transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
        >
          TURN ON REMINDERS
        </button>

        <button
          type="button"
          onClick={dismiss}
          className="w-full font-body text-xs font-bold text-ink/50 hover:text-ink underline underline-offset-2"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
