'use client';

interface CategoryPerformance {
  category: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
  average_score: number;
  best_score: number;
}

interface CategoryPerformanceCardProps {
  categories: CategoryPerformance[];
}

export function CategoryPerformanceCard({ categories }: CategoryPerformanceCardProps) {
  if (categories.length === 0) {
    return (
      <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl">
        <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">
          Category Performance
        </h2>
        <p className="font-body text-sm text-ink/80 text-center">
          No category data available yet. Complete quizzes to see your performance by category!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl">
      <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">
        Category Performance
      </h2>
      <div className="space-y-3">
        {categories.map((cat) => (
          <div
            key={cat.category}
            className="bg-paper border-[3px] border-ink rounded-lg p-4"
          >
            {/* Category Header */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg font-bold text-ink uppercase">
                {cat.category}
              </h3>
              <div className="text-right">
                <div className="font-display text-xl font-bold text-ink">
                  {cat.accuracy}%
                </div>
                <div className="text-xs text-ink/80 font-bold">ACCURACY</div>
              </div>
            </div>

            {/* Accuracy Bar */}
            <div className="mb-3">
              <div className="h-4 bg-ink/10 border-[2px] border-ink rounded-full overflow-hidden">
                <div
                  className="h-full bg-green transition-all duration-300"
                  style={{ width: `${cat.accuracy}%` }}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-cyanA/20 border-[2px] border-ink rounded p-2 text-center">
                <div className="font-display text-lg font-bold text-ink">
                  {cat.correct_count}/{cat.total_questions}
                </div>
                <div className="text-[10px] text-ink/80 font-bold uppercase">
                  CORRECT
                </div>
              </div>
              <div className="bg-yellow/20 border-[2px] border-ink rounded p-2 text-center">
                <div className="font-display text-lg font-bold text-ink">
                  {cat.average_score.toFixed(1)}
                </div>
                <div className="text-[10px] text-ink/80 font-bold uppercase">
                  AVG SCORE
                </div>
              </div>
              <div className="bg-green/20 border-[2px] border-ink rounded p-2 text-center">
                <div className="font-display text-lg font-bold text-ink">
                  {cat.best_score.toFixed(0)}
                </div>
                <div className="text-[10px] text-ink/80 font-bold uppercase">
                  BEST
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

