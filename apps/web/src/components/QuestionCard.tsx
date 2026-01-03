interface QuestionCardProps {
  questionText: string;
  questionNumber: number;
  tags?: string[];
}

export function QuestionCard({ questionText, questionNumber, tags }: QuestionCardProps) {
  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-5 w-full">
      {tags && tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {tags.map((tag, idx) => (
            <span
              key={idx}
              className="bg-cyanA border-[3px] border-ink rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="font-bold text-[22px] text-left leading-relaxed text-ink">
        {questionText}
      </p>
    </div>
  );
}

