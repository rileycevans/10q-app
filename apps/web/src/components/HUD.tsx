interface HUDProps {
  progress?: number; // 0-10, current question index
  score?: number;
  timeRemaining?: number; // milliseconds
  category?: string;
}

export function HUD({ progress = 0, score = 0, timeRemaining, category }: HUDProps) {
  return (
    <div className="flex items-center justify-between w-full px-4 py-2 gap-3">
      {/* Left: Progress */}
      <div className="flex items-center gap-2">
        <div className="bg-paper border-[3px] border-ink rounded-full px-3 py-1.5 shadow-sticker-hud">
          <span className="text-xs font-bold uppercase tracking-wide text-ink">
            {progress}/10
          </span>
        </div>
      </div>

      {/* Center: Category */}
      {category && (
        <div className="bg-paper border-[3px] border-ink rounded-full px-3 py-1.5 shadow-sticker-hud">
          <span className="text-xs font-bold uppercase tracking-wide text-ink">
            {category}
          </span>
        </div>
      )}

      {/* Right: Score/Time */}
      <div className="flex items-center gap-2">
        {timeRemaining !== undefined && (
          <div className="bg-paper border-[3px] border-ink rounded-full px-3 py-1.5 shadow-sticker-hud">
            <span className="text-xs font-bold uppercase tracking-wide text-ink">
              {Math.ceil(timeRemaining / 1000)}s
            </span>
          </div>
        )}
        <div className="bg-paper border-[3px] border-ink rounded-full px-3 py-1.5 shadow-sticker-hud">
          <span className="text-xs font-bold uppercase tracking-wide text-ink">
            {score} pts
          </span>
        </div>
      </div>
    </div>
  );
}

