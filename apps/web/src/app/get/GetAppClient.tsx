'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links';

type Platform = 'ios' | 'android' | 'desktop';

/**
 * Detection is deliberately conservative and runs only in the browser.
 *
 * iPadOS reports itself as a Mac, so the touch check is what separates a real
 * desktop from an iPad — without it, iPad users get sent to the website
 * instead of the App Store.
 */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';

  const ua = navigator.userAgent;

  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';

  // iPadOS 13+ masquerades as macOS; a Mac has no touch points.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';

  return 'desktop';
}

/**
 * Platform detection has to satisfy three things at once: the server render
 * and the first client render must agree (or React warns and the wrong
 * destination flashes), the value must never change after mount, and reading
 * it must not trigger a second render pass.
 *
 * useSyncExternalStore does all three. The previous useState + useEffect
 * version set state synchronously inside the effect, which React flags as a
 * cascading render — and which failed CI's lint gate, blocking every deploy
 * behind it.
 *
 * The subscribe function is a no-op because the value genuinely cannot
 * change: a device does not stop being an iPhone mid-session.
 */
const NOOP_SUBSCRIBE = () => () => {};

export function GetAppClient() {
  // Server snapshot is null, matching what the server can actually know;
  // the client snapshot resolves on the first client render, before paint.
  const platform = useSyncExternalStore<Platform | null>(
    NOOP_SUBSCRIBE,
    detectPlatform,
    () => null,
  );

  const storeUrl =
    platform === 'ios' ? APP_STORE_URL
    : platform === 'android' ? PLAY_STORE_URL
    : null;

  const storeName =
    platform === 'ios' ? 'the App Store'
    : platform === 'android' ? 'Google Play'
    : null;

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 sm:p-8 w-full max-w-md text-center">
          <h1 className="font-display text-4xl mb-3 text-ink">10Q</h1>
          <p className="font-body text-ink/80 font-bold mb-8">
            10 questions. One attempt. A new quiz every day.
          </p>

          <div className="flex flex-col gap-3">
            {/*
              Playing in the browser is always offered and always first when
              there is no store link for this device. It is the same game, so
              a missing app listing is never a dead end.
            */}
            {storeUrl ? (
              <>
                <a
                  href={storeUrl}
                  className="flex items-center justify-center w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
                >
                  Get it on {storeName}
                </a>
                <Link
                  href="/"
                  className="flex items-center justify-center w-full h-12 bg-paper border-[3px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
                >
                  Play in your browser
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/"
                  className="flex items-center justify-center w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
                >
                  Play now
                </Link>
                {/*
                  Only claim an app is coming once the platform is known —
                  otherwise a desktop visitor is told to wait for something
                  they were never going to install.
                */}
                {platform === 'ios' || platform === 'android' ? (
                  <p className="font-body text-sm text-ink/60 mt-1">
                    The {platform === 'ios' ? 'iPhone' : 'Android'} app is on its
                    way. Play in your browser meanwhile — same game, same
                    account.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
