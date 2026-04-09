import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/';
  const errorCode = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');
  const provider = requestUrl.searchParams.get('provider') || 'unknown';

  if (errorCode || errorDescription) {
    Sentry.withScope((scope) => {
      scope.setTag('auth.flow', 'oauth_callback');
      scope.setTag('auth.provider', provider);
      scope.setLevel('error');
      scope.setContext('auth_callback', {
        errorCode,
        errorDescription,
        next,
        url: requestUrl.toString().replace(code ?? '', '[redacted-code]'),
      });
      Sentry.captureMessage('OAuth callback returned error params');
    });
    return NextResponse.redirect(new URL(`/?error=auth_failed`, requestUrl.origin));
  }

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('Error exchanging code for session:', error);
      Sentry.withScope((scope) => {
        scope.setTag('auth.flow', 'oauth_callback');
        scope.setTag('auth.provider', provider);
        scope.setLevel('error');
        scope.setContext('auth_callback', {
          next,
          hasCode: Boolean(code),
        });
        Sentry.captureException(error);
      });
      return NextResponse.redirect(new URL(`/?error=auth_failed`, requestUrl.origin));
    }
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
