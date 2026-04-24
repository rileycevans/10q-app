'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { SignInModal } from '@/components/SignInModal';
import { ProfileStatsCard } from '@/components/ProfileStatsCard';
import { CategoryPerformanceCard } from '@/components/CategoryPerformanceCard';
import { getProfileByHandle, type Profile } from '@/domains/profile';
import { resetIdentity, trackSignOut, trackScreenView } from '@/lib/analytics';

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
  const [stats, setStats] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);

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
          .select('handle_display, handle_canonical')
          .eq('id', user.id)
          .single();

        setProfile({
          email: user.email,
          avatarUrl,
          handle: player?.handle_display ?? null,
          provider,
          isAnonymous: user.is_anonymous ?? true,
        });

        if (player?.handle_canonical) {
          try {
            const fullProfile = await getProfileByHandle(player.handle_canonical);
            setStats(fullProfile);
          } catch {
            // Stats are optional; fail silently
          }
        }
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

  const emptyStats: Profile['stats'] = {
    all_time_best: 0,
    all_time_worst: 0,
    total_games: 0,
    average_score: 0,
    perfect_games: 0,
    overall_accuracy: 0,
    avg_time_per_question_ms: 0,
  };
  const emptyStreaks: Profile['streaks'] = { current_streak: 0, longest_streak: 0 };

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8 gap-6">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-md">
          <h1 className="font-display text-3xl mb-4 text-ink text-center">Profile</h1>

          {/* Signed-in status */}
          {profile && (
            <div
              className={`${
                profile.isAnonymous ? 'bg-red/20' : 'bg-green/20'
              } border-[3px] border-ink rounded-lg p-3 mb-4 flex items-center gap-3`}
            >
              <span
                className={`w-3 h-3 rounded-full border-[2px] border-ink ${
                  profile.isAnonymous ? 'bg-red' : 'bg-green'
                }`}
                aria-hidden
              />
              <div className="flex-1">
                <p className="font-body text-xs text-ink/60 uppercase tracking-wide">Status</p>
                <p className="font-body font-bold text-sm text-ink">
                  {profile.isAnonymous ? 'Not signed in' : 'Signed in'}
                </p>
              </div>
            </div>
          )}

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
            {/* Sign In (anonymous only) */}
            {profile && profile.isAnonymous && (
              <button
                onClick={() => setShowSignInModal(true)}
                className="w-full h-12 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
              >
                Sign In
              </button>
            )}

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

        {profile && !profile.isAnonymous && (
          <>
            <ProfileStatsCard
              stats={stats?.stats ?? emptyStats}
              streaks={stats?.streaks ?? emptyStreaks}
            />
            {stats && stats.category_performance.length > 0 && (
              <CategoryPerformanceCard categories={stats.category_performance} />
            )}
          </>
        )}
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </ArcadeBackground>
  );
}
