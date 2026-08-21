'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { navigation, configureStatusBar } from '@/platform';

/**
 * Android hardware back.
 *
 * Android's back button has no web equivalent, and its default inside a
 * Capacitor shell is to pop the WebView history — which, without the
 * push→replace work in the play flow, would walk a player backwards through
 * questions the server considers answered.
 *
 * Per-route policy, because there is no single correct answer:
 *
 *   /play/*   consumed. A quiz is one attempt per day on a server clock;
 *             there is no valid "back" inside it, and leaving accidentally
 *             cannot be undone. The exit is the on-screen control.
 *   /         consumed. Back from the home screen would exit the app, which
 *             is conventional on Android — but 10Q is a single-screen-a-day
 *             game and an accidental exit mid-session is worse than a
 *             no-op. Revisit if users report it feeling trapped.
 *   else      not consumed: navigate home. Every other screen is a leaf
 *             reachable from home, so home is where back belongs.
 *
 * A no-op on web, where `navigation.onBack` returns an unsubscribe and never
 * fires — there is no hardware back, and hijacking browser back would break
 * the one navigation affordance web users already have.
 */
export function BackButtonHandler() {
  const router = useRouter();
  const pathname = usePathname();

  // Status-bar setup, once. It lives here rather than in its own component
  // because this already mounts at the root and never unmounts.
  //
  // The StatusBar block in capacitor.config.ts only supplies DEFAULTS for
  // these calls — it does not apply them. Without this, iOS reserves the
  // status-bar strip and paints it black, which is the band that showed
  // across the top of the app on device.
  useEffect(() => {
    void configureStatusBar();
  }, []);

  useEffect(() => {
    return navigation.onBack(() => {
      // Never leave a quiz on a hardware back press.
      if (pathname.startsWith('/play')) return true;

      // Home: consume rather than exit the app.
      if (pathname === '/') return true;

      router.replace('/');
      return true;
    });
  }, [pathname, router]);

  return null;
}
