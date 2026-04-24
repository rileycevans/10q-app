'use client';

import type { Profile } from '@/domains/profile';

interface ProfileStatsCardProps {
  stats: Profile['stats'];
  streaks: Profile['streaks'];
}

function formatSeconds(ms: number | null): string {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(value: number | null, digits = 0): string {
  if (value === null) return '—';
  return value.toFixed(digits);
}

interface StatTileProps {
  label: string;
  value: string;
  bg: string;
}

function StatTile({ label, value, bg }: StatTileProps) {
  return (
    <div className={`${bg} border-[3px] border-ink rounded-lg p-4 text-center`}>
      <p className="font-body text-xs text-ink/80 mb-1">{label}</p>
      <p className="font-display text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

interface StatGroupProps {
  title: string;
  children: React.ReactNode;
}

function StatGroup({ title, children }: StatGroupProps) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="font-body font-bold text-sm text-ink/70 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function ProfileStatsCard({ stats, streaks }: ProfileStatsCardProps) {
  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl">
      <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">Stats</h2>

      <StatGroup title="Overview">
        <StatTile label="Games Played" value={String(stats.total_games)} bg="bg-green" />
        <StatTile label="Perfect Games" value={String(stats.perfect_games)} bg="bg-green/60" />
        <StatTile
          label="Overall Accuracy"
          value={stats.overall_accuracy !== null ? `${stats.overall_accuracy}%` : '0%'}
          bg="bg-green/40"
        />
      </StatGroup>

      <StatGroup title="Scoring">
        <StatTile
          label="All-Time Best"
          value={formatNumber(stats.all_time_best ?? 0)}
          bg="bg-cyanA"
        />
        <StatTile
          label="All-Time Worst"
          value={formatNumber(stats.all_time_worst ?? 0)}
          bg="bg-yellow"
        />
        <StatTile
          label="Average Score"
          value={formatNumber(stats.average_score ?? 0, 1)}
          bg="bg-purpleA"
        />
      </StatGroup>

      <StatGroup title="Streaks">
        <StatTile label="Current Streak" value={String(streaks.current_streak)} bg="bg-orange" />
        <StatTile label="Longest Streak" value={String(streaks.longest_streak)} bg="bg-orange/60" />
      </StatGroup>

      <StatGroup title="Speed">
        <StatTile
          label="Avg Time / Question"
          value={formatSeconds(stats.avg_time_per_question_ms ?? 0)}
          bg="bg-cyanA/60"
        />
      </StatGroup>
    </div>
  );
}
