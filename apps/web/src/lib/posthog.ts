import posthog from 'posthog-js';
import { buildIdentity } from './version';

let initialized = false;

export function initPostHog() {
  if (initialized) return;
  if (typeof window === 'undefined') return;

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[analytics] NEXT_PUBLIC_POSTHOG_KEY is not set; analytics disabled');
    }
    return;
  }

  posthog.init(apiKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: false,
  });

  // The five identifiers, as super properties so every event carries them
  // without each call site remembering. Registered immediately after init so
  // no event can be captured without them.
  //
  // client_platform is the one that matters most once native ships: without it
  // there is no way to tell an iOS regression from a web one, and every funnel
  // silently blends three platforms.
  posthog.register(buildIdentity());

  initialized = true;
}

export { posthog };

