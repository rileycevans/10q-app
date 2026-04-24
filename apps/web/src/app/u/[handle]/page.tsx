'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getProfileByHandle, type Profile } from '@/domains/profile';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { CategoryPerformanceCard } from '@/components/CategoryPerformanceCard';
import { ProfileStatsCard } from '@/components/ProfileStatsCard';
import dynamic from 'next/dynamic';
import { trackScreenView, trackProfileView, trackAppError } from '@/lib/analytics';

const AuthButton = dynamic(
  () => import('@/components/AuthButton').then((mod) => mod.AuthButton),
  { ssr: false }
);

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const handle = params.handle as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchProfile() {
      if (!mounted) return;

      try {
        setLoading(true);
        setError(null);

        const data = await getProfileByHandle(handle);
        if (mounted) {
          setProfile(data);

          trackScreenView({
            screen: 'profile',
            route: `/u/${handle}`,
          });

          trackProfileView({
            player_id: data.player_id,
            handle: data.handle_display,
          });
        }
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load profile';
        setError(errorMessage);
        console.error('Profile page error:', err);
        trackAppError({
          location: 'profile_fetch',
          message: errorMessage,
        });
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (handle) {
      fetchProfile();
    }

    return () => {
      mounted = false;
    };
  }, [handle]);

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading Profile...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (error || !profile) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="absolute top-4 right-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">Profile Not Found</h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">
              {error || 'User not found'}
            </p>
            <button
              onClick={() => router.push('/')}
              className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
            >
              Go Home
            </button>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center min-h-screen px-4 py-8">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>

        {/* Profile Header */}
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6 text-center">
          <h1 className="font-display text-4xl mb-2 text-ink">{profile.handle_display}</h1>
          <p className="font-body text-sm text-ink/80 mb-4">
            Joined {new Date(profile.created_at).toLocaleDateString()}
          </p>
        </div>

        {/* Stats */}
        <div className="w-full max-w-2xl mb-6 flex justify-center">
          <ProfileStatsCard stats={profile.stats} streaks={profile.streaks} />
        </div>

        {/* Category Performance */}
        {profile.category_performance && profile.category_performance.length > 0 && (
          <div className="mb-6">
            <CategoryPerformanceCard categories={profile.category_performance} />
          </div>
        )}

        {/* Recent Results */}
        {profile.recent_results.length > 0 && (
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl mb-6">
            <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">Recent Results</h2>
            <div className="space-y-2">
              {profile.recent_results.map((result, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-3 px-4 bg-paper border-[3px] border-ink rounded-lg"
                >
                  <div>
                    <p className="font-body font-bold text-sm text-ink">
                      {new Date(result.completed_at).toLocaleDateString()}
                    </p>
                    <p className="font-body text-xs text-ink/80">
                      {result.correct_count}/10 correct
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-xl font-bold text-ink">
                      {result.score.toFixed(0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Back Button */}
        <button
          onClick={() => router.push('/')}
          className="mt-8 h-12 px-6 bg-paper border-[3px] border-ink rounded-full shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px] hover:-translate-x-[1px] hover:-translate-y-[1px]"
        >
          Go Home
        </button>
      </div>
    </ArcadeBackground>
  );
}

