import posthog from 'posthog-js';

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

  initialized = true;
}

export { posthog };

