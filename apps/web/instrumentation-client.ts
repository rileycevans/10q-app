import * as Sentry from '@sentry/nextjs';
import {
  APP_ENVIRONMENT,
  APP_BUILD,
  CLIENT_PLATFORM,
  RELEASE_SHA,
  SENTRY_RELEASE,
  APP_VERSION,
} from '@/lib/version';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Was process.env.NODE_ENV, which is 'production' for every built artifact —
  // so a staging crash was indistinguishable from a live one. Now driven by the
  // build config (Phase 2, OBSERVABILITY.md).
  environment: APP_ENVIRONMENT,

  // release + dist is what makes a crash from an old store binary
  // symbolicatable. `release` is the product version plus artifact id; `dist`
  // is the artifact id alone, which is what Sentry matches source maps on.
  // Without these, a stack trace from a three-week-old iOS build is minified
  // noise — and mobile binaries stay installed for months.
  release: SENTRY_RELEASE,
  dist: APP_BUILD,

  initialScope: {
    tags: {
      // The dimension that matters once native ships: without it there is no
      // way to tell an iOS-only regression from a web one.
      client_platform: CLIENT_PLATFORM,
      app_version: APP_VERSION,
      app_build: APP_BUILD,
      release_sha: RELEASE_SHA,
    },
  },

  // Focus on error reporting; tracing can be enabled later if needed
  tracesSampleRate: 0,

  // Enable structured logging so we can use Sentry.logger
  enableLogs: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
