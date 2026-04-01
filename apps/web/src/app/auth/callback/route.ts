import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';

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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Exchange code for session
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
      // Redirect to home with error
      return NextResponse.redirect(new URL(`/?error=auth_failed`, requestUrl.origin));
    }
  }

  // Redirect to home page (or next URL) after successful auth
  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

