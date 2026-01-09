'use client';

import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import dynamic from 'next/dynamic';

// Dynamically import AuthButton to avoid SSR issues
const AuthButton = dynamic(() => import('@/components/AuthButton').then(mod => ({ default: mod.AuthButton })), {
  ssr: false,
  loading: () => (
    <div className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm opacity-50">
      <span className="text-xs text-ink">Loading...</span>
    </div>
  ),
});

export default function HomePage() {
  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
        <div className="absolute top-4 right-4">
          <AuthButton />
        </div>
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
          <h1 className="font-display text-4xl mb-4 text-ink">10Q</h1>
          <p className="font-body font-bold text-lg mb-6 text-ink">
            Daily Trivia Game
          </p>
          <p className="font-body text-sm mb-8 text-ink/80">
            10 questions. One attempt. Every day at 11:30 UTC.
          </p>
          <div className="space-y-3">
            <Link
              href="/play"
              className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2"
            >
              PLAY NOW
            </Link>
            <Link
              href="/leaderboard"
              className="block w-full h-14 bg-green border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-green focus-visible:outline-offset-2"
            >
              LEADERBOARD
            </Link>
            <Link
              href="/leagues"
              className="block w-full h-14 bg-yellow border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-yellow focus-visible:outline-offset-2"
            >
              LEAGUES
            </Link>
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}
