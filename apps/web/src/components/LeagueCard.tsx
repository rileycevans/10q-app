'use client';

import Link from 'next/link';
import type { League } from '@/domains/league';

interface LeagueCardProps {
  league: League;
}

export function LeagueCard({ league }: LeagueCardProps) {
  return (
    <Link
      href={`/leagues/${league.league_id}`}
      className="block bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-5 w-full transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-display text-xl font-bold text-ink mb-2">{league.name}</h3>
          <p className="font-body text-sm text-ink/80">
            {league.member_count} {league.member_count === 1 ? 'member' : 'members'}
          </p>
        </div>
        <div className="ml-4">
          <span
            className={`px-3 py-1 rounded-full border-[3px] border-ink font-bold text-xs ${
              league.is_owner ? 'bg-yellow text-ink' : 'bg-cyanA text-ink'
            }`}
          >
            {league.is_owner ? 'OWNER' : 'MEMBER'}
          </span>
        </div>
      </div>
    </Link>
  );
}

