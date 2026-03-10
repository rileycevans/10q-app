import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,

  // Focus on error reporting; tracing can be enabled later if needed
  tracesSampleRate: 0,

  // Enable structured logging so we can use Sentry.logger
  enableLogs: true,
});

