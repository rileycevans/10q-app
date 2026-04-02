interface QuestionCardProps {
  questionText: string;
  questionNumber: number;
  totalQuestions?: number;
  tags?: string[];
}

export function QuestionCard({ questionText, questionNumber, totalQuestions = 10, tags: _tags }: QuestionCardProps) {
  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker px-6 py-6 w-full">
      <span className="text-xs font-bold uppercase tracking-wide text-ink/50 mb-2 block">
        Question {questionNumber} of {totalQuestions}
      </span>
      <p className="font-bold text-[19px] text-left leading-[1.55] text-ink">
        {questionText}
      </p>
    </div>
  );
}

