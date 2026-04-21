interface BottomDockProps {
  streak?: number;
  avatarUrl?: string | null;
  isAnonymous?: boolean;
  onRankClick?: () => void;
  onStreakClick?: () => void;
  onLeagueClick?: () => void;
  onSettingsClick?: () => void;
  onProfileClick?: () => void;
}

export function BottomDock({
  streak,
  avatarUrl,
  isAnonymous,
  onRankClick,
  onStreakClick,
  onLeagueClick,
  onSettingsClick,
  onProfileClick,
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
        className="min-w-14 h-14 px-2 bg-orange border-[4px] border-ink rounded-lg shadow-sticker-sm flex items-center justify-center gap-1 font-bold text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-orange focus-visible:outline-offset-2"
        onClick={onStreakClick}
        aria-label={`View streak${streak ? `: ${streak} days` : ''}`}
      >
        <span>🔥</span>
        {streak != null && streak > 0 && (
          <span className="font-display text-sm">{streak}</span>
        )}
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
      <button
        className="relative w-14 h-14 bg-paper border-[4px] border-ink rounded-lg shadow-sticker-sm flex items-center justify-center overflow-visible transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2"
        onClick={onProfileClick}
        aria-label={isAnonymous ? 'Profile (not signed in)' : 'Profile'}
      >
        <span className="w-full h-full flex items-center justify-center overflow-hidden rounded-[4px]">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Profile"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-2xl">👤</span>
          )}
        </span>
        {isAnonymous && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red border-[2px] border-ink rounded-full flex items-center justify-center font-display text-[11px] text-paper leading-none"
          >
            !
          </span>
        )}
      </button>
    </div>
  );
}

