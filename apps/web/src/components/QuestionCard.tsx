interface QuestionCardProps {
  questionText: string;
  questionNumber: number;
  tags?: string[];
}

export function QuestionCard({ questionText, questionNumber: _questionNumber, tags: _tags }: QuestionCardProps) {
  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker px-8 py-8 w-full">
      <p className="font-bold text-[20px] text-left leading-relaxed text-ink">
        {questionText}
      </p>
    </div>
  );
}

