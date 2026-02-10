'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArcadeBackground } from '@/components/ArcadeBackground';

export default function TomorrowPage() {
  const [countdown, setCountdown] = useState<string>('');

  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(11, 30, 0, 0);

      // If it's already past 11:30 UTC today, set for tomorrow
      if (now.getUTCHours() > 11 || (now.getUTCHours() === 11 && now.getUTCMinutes() >= 30)) {
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      }

      const diff = tomorrow.getTime() - now.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(`${hours}h ${minutes}m ${seconds}s`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <ArcadeBackground>
      <div className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
          <h1 className="font-display text-3xl mb-4 text-ink">Come Back Tomorrow</h1>
          <p className="font-body font-bold text-lg mb-6 text-ink">
            You&apos;ve already completed today&apos;s quiz!
          </p>
          <p className="font-body text-sm mb-4 text-ink/80">
            Next quiz releases in:
          </p>
          <p className="font-display text-2xl mb-8 text-ink">
            {countdown || 'Calculating...'}
          </p>
          <div className="space-y-3">
            <Link
              href="/results"
              className="block w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
            >
              View Results
            </Link>
            <Link
              href="/"
              className="block w-full h-14 bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    </ArcadeBackground>
  );
}

