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
  if (categories.length === 0) return null;

  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-6 w-full max-w-2xl">
      <h2 className="font-display text-2xl font-bold text-ink mb-4 text-center">
        Category Performance
      </h2>
      <div className="space-y-3">
        {categories.map((cat) => (
          <div
            key={cat.category}
            className="flex items-center justify-between py-3 px-4 bg-paper border-[3px] border-ink rounded-lg"
          >
            <div>
              <p className="font-body font-bold text-sm text-ink capitalize">
                {cat.category}
              </p>
              <p className="font-body text-xs text-ink/80">
                {cat.correct_count}/{cat.total_questions} correct
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-xl font-bold text-ink">
                {cat.accuracy}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
