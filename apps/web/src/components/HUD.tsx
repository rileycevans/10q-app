interface HUDProps {
  progress?: number; // 0-10, current question index
  score?: number;
  timeRemaining?: number; // milliseconds
  category?: string;
}

export function HUD({ progress = 0, score: _score = 0, timeRemaining: _timeRemaining, category: _category }: HUDProps) {
  return (
    <div className="bg-paper border-[3px] border-ink rounded-full px-3 py-1.5 shadow-sticker-hud shrink-0">
      <span className="text-xs font-bold uppercase tracking-wide text-ink">
        {progress}/10
      </span>
    </div>
  );
}

