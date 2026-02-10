'use client';

import { useState } from 'react';
import { upgradeToGoogle } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      // Check if current user is anonymous — if so, upgrade (preserves data)
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.is_anonymous) {
        // linkIdentity merges anon account into Google — same UUID, all data kept
        await upgradeToGoogle();
      } else {
        // No session or already a real user — standard OAuth
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        });
      }
    } catch (error) {
      console.error('Sign in error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md mx-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-ink hover:bg-ink/10 rounded-full"
        >
          ✕
        </button>

        <h2 className="font-display text-2xl font-bold text-ink mb-6 text-center">
          Sign In with Google
        </h2>

        <button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center gap-3 transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] disabled:opacity-50"
        >
          {isLoading ? 'Signing in...' : 'Continue with Google'}
        </button>
      </div>
    </div>
  );
}
