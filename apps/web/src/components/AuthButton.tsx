'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { signOut } from '@/lib/auth';
import { SignInModal } from './SignInModal';
import { resetIdentity, trackSignOut } from '@/lib/analytics';

export function AuthButton() {
  // Auth state comes from the app-wide provider rather than a subscription
  // owned by this component — it used to be the only listener, so auth
  // changes went unobserved on any screen without a sign-in button.
  const { isAnonymous, isSignedIn: hasSession, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showSignInModal, setShowSignInModal] = useState(false);

  function handleSignIn() {
    setShowSignInModal(true);
  }

  async function handleSignOut() {
    try {
      // No local loading/session state to manage: the provider observes the
      // sign-out through onAuthStateChange and re-renders this component.
      trackSignOut();
      await signOut();
      resetIdentity();
    } catch (error) {
      console.error('Sign out error:', error);
      setError('Failed to sign out');
    }
  }

  if (error) {
    return (
      <div className="h-auto px-4 py-2 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-xs text-ink max-w-xs">
        <div className="mb-1">Auth Error</div>
        <div className="text-[10px] font-normal leading-tight">{error}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <button
        className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink opacity-50 cursor-not-allowed"
        disabled
      >
        Loading...
      </button>
    );
  }

  // User is signed in with a real provider — show Sign Out
  if (hasSession && !isAnonymous) {
    return (
      <button
        onClick={handleSignOut}
        className="h-10 px-4 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
      >
        Sign Out
      </button>
    );
  }

  // Anonymous or no session — show Sign In (Google / Apple in modal)
  return (
    <>
      <button
        onClick={handleSignIn}
        className="h-10 px-4 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
      >
        Sign In
      </button>
      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
}
