interface BottomDockProps {
  onRankClick?: () => void;
  onStreakClick?: () => void;
  onLeagueClick?: () => void;
  onSettingsClick?: () => void;
}

export function BottomDock({
  onRankClick,
  onStreakClick,
  onLeagueClick,
  onSettingsClick,
}: BottomDockProps) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-3">
      <button
        className="w-14 h-14 bg-green border-[4px] border-ink rounded-lg shadow-sticker-sm flex items-center justify-center font-bold text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-green focus-visible:outline-offset-2"
        onClick={onRankClick}
        aria-label="View rank"
      >
        🏆
      </button>
      <button
        className="w-14 h-14 bg-orange border-[4px] border-ink rounded-lg shadow-sticker-sm flex items-center justify-center font-bold text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-orange focus-visible:outline-offset-2"
        onClick={onStreakClick}
        aria-label="View streak"
      >
        🔥
      </button>
      <button
        className="w-14 h-14 bg-yellow border-[4px] border-ink rounded-lg shadow-sticker-sm flex items-center justify-center font-bold text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-yellow focus-visible:outline-offset-2"
        onClick={onLeagueClick}
        aria-label="View leagues"
      >
        👥
      </button>
      <button
        className="w-14 h-14 bg-paper border-[4px] border-ink rounded-lg shadow-sticker-sm flex items-center justify-center font-bold text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2"
        onClick={onSettingsClick}
        aria-label="Settings"
      >
        ⚙️
      </button>
    </div>
  );
}

