interface HUDProps {
  progress?: number; // 0-10, current question index
  score?: number;
  timeRemaining?: number; // milliseconds
  category?: string;
}

export function HUD({ progress = 0, score = 0, timeRemaining, category }: HUDProps) {
  return (
    <div className="flex items-center justify-center w-full px-4 py-2">
      {/* Center: Progress */}
      <div className="bg-paper border-[3px] border-ink rounded-full px-3 py-1.5 shadow-sticker-hud">
        <span className="text-xs font-bold uppercase tracking-wide text-ink">
          {progress}/10
        </span>
      </div>
    </div>
  );
}

