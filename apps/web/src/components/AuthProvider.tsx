'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { lifecycle } from '@/platform';
import { identifyUser, setPersonProperties } from '@/lib/analytics';

/**
 * One auth subscription for the whole app.
 *
 * `onAuthStateChange` used to be owned by AuthButton, so auth state was only
 * observed while that component happened to be mounted. A token refresh or a
 * sign-out on a screen without it went unnoticed until something re-read the
 * session.
 *
 * That gets worse on native. The app resumes from background against a
 * server-authoritative clock, and the access token may have expired while it
 * was suspended — so the moment auth state is least trustworthy is exactly the
 * moment nothing was listening.
 */

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  isSignedIn: boolean;
  /** Anonymous until proven otherwise: every visitor is signed in anonymously. */
  isAnonymous: boolean;
}

const AuthContext = createContext<AuthState>({
  session: null,
  isLoading: true,
  isSignedIn: false,
  isAnonymous: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });

    // Re-check on foreground. A refresh timer does not fire reliably in a
    // suspended WebView, so a session that expired while the app was in the
    // background would otherwise stay stale until the next failed request.
    const stopLifecycle = lifecycle.onAppStateChange((state) => {
      if (state !== 'active') return;
      supabase.auth.getSession().then(({ data }) => {
        if (active) setSession(data.session);
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      stopLifecycle();
    };
  }, []);

  // Analytics identity follows the session. This used to live in AuthButton,
  // which meant a sign-in completed on a screen without that button never
  // identified the user to PostHog.
  const user = session?.user;
  useEffect(() => {
    if (!user) return;

    if (user.is_anonymous) {
      setPersonProperties({ is_anonymous: true });
    } else {
      identifyUser(user.id, { email: user.email });
      setPersonProperties({ is_anonymous: false });
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        isSignedIn: !!session,
        isAnonymous: session?.user?.is_anonymous ?? true,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
