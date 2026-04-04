'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { identifyUser, resetIdentity, trackSignOut, trackScreenView } from '@/lib/analytics';

interface ProfileData {
  email: string | undefined;
  avatarUrl: string | null;
  handle: string | null;
  provider: string | null;
  isAnonymous: boolean;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    trackScreenView({ screen: 'profile', route: '/profile' });

    async function loadProfile() {
      try {
        const session = await getSession();
        if (!session) {
          router.replace('/');
          return;
        }

        const user = session.user;
        const provider = user.app_metadata?.provider ?? null;
        const avatarUrl = user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null;

        const { data: player } = await supabase
          .from('players')
          .select('handle_display')
          .eq('id', user.id)
          .single();

        setProfile({
          email: user.email,
          avatarUrl,
          handle: player?.handle_display ?? null,
          provider,
          isAnonymous: user.is_anonymous ?? true,
        });
      } catch {
        // Non-critical
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [router]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      trackSignOut();
      await signOut();
      resetIdentity();
      router.replace('/');
    } catch (error) {
      console.error('Sign out error:', error);
      setSigningOut(false);
    }
  }

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-md">
          <h1 className="font-display text-3xl mb-6 text-ink text-center">Profile</h1>

          {profile && (
            <div className="space-y-4 mb-6">
              {/* Avatar */}
              {profile.avatarUrl && (
                <div className="flex justify-center">
                  <img
                    src={profile.avatarUrl}
                    alt="Profile"
                    className="w-20 h-20 rounded-full border-[4px] border-ink object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              {/* Handle */}
              {profile.handle && (
                <div className="p-3 bg-cyanA/20 border-[3px] border-ink rounded-lg">
                  <p className="font-body text-xs text-ink/60 uppercase tracking-wide mb-1">Handle</p>
                  <p className="font-body font-bold text-base text-ink">{profile.handle}</p>
                </div>
              )}

              {/* Email */}
              {profile.email && (
                <div className="p-3 bg-cyanA/20 border-[3px] border-ink rounded-lg">
                  <p className="font-body text-xs text-ink/60 uppercase tracking-wide mb-1">Email</p>
                  <p className="font-body font-bold text-base text-ink">{profile.email}</p>
                </div>
              )}

              {/* Provider */}
              {profile.provider && !profile.isAnonymous && (
                <div className="p-3 bg-cyanA/20 border-[3px] border-ink rounded-lg">
                  <p className="font-body text-xs text-ink/60 uppercase tracking-wide mb-1">Signed in with</p>
                  <p className="font-body font-bold text-base text-ink capitalize">{profile.provider}</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {/* Settings link */}
            <button
              onClick={() => router.push('/settings')}
              className="w-full h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
            >
              Settings
            </button>

            {/* Sign Out */}
            {profile && !profile.isAnonymous && (
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full h-12 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {signingOut ? 'Signing Out...' : 'Sign Out'}
              </button>
            )}

            {/* Back */}
            <button
              onClick={() => router.push('/')}
              className="w-full h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
