'use client';

import type { LeaderboardEntry } from '@/domains/leaderboard';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  userRank: number | null;
  userPlayerId: string | null;
  scoreType: 'cumulative' | 'average';
}

export function LeaderboardTable({
  entries,
  userRank: _userRank,
  userPlayerId,
  scoreType,
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 text-center">
        <p className="font-bold text-lg text-ink">No entries yet</p>
        <p className="font-body text-sm text-ink/80 mt-2">Be the first to play!</p>
      </div>
    );
  }

  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-4 w-full">
      {/* Table Header */}
      <div className="grid grid-cols-[60px_1fr_120px_80px] gap-4 pb-3 mb-3 border-b-[3px] border-ink">
        <div className="font-display font-bold text-sm uppercase tracking-wide text-ink">Rank</div>
        <div className="font-display font-bold text-sm uppercase tracking-wide text-ink">Player</div>
        <div className="font-display font-bold text-sm uppercase tracking-wide text-ink text-right">
          {scoreType === 'cumulative' ? 'Total' : 'Avg'} Score
        </div>
        <div className="font-display font-bold text-sm uppercase tracking-wide text-ink text-right">
          Games
        </div>
      </div>

      {/* Table Rows */}
      <div className="space-y-2">
        {entries.map((entry) => {
          const isUser = userPlayerId && entry.player_id === userPlayerId;
          return (
            <div
              key={entry.player_id}
              className={`grid grid-cols-[60px_1fr_120px_80px] gap-4 py-3 px-2 rounded-lg border-[3px] border-ink transition-all ${isUser
                  ? 'bg-cyanA shadow-sticker-sm'
                  : 'bg-paper hover:bg-cyanA/20'
                }`}
            >
              <div className="font-display font-bold text-lg text-ink flex items-center">
                {entry.rank}
              </div>
              <div className="font-body font-bold text-base text-ink flex items-center truncate">
                {entry.handle_display}
                {isUser && (
                  <span className="ml-2 text-xs bg-ink text-paper px-2 py-0.5 rounded-full border-[2px] border-ink">
                    YOU
                  </span>
                )}
              </div>
              <div className="font-display font-bold text-lg text-ink text-right flex items-center justify-end">
                {entry.aggregated_score.toFixed(1)}
              </div>
              <div className="font-body text-sm text-ink/80 text-right flex items-center justify-end">
                {entry.attempt_count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

