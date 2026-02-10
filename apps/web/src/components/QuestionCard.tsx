interface QuestionCardProps {
  questionText: string;
  questionNumber: number;
  tags?: string[];
}

export function QuestionCard({ questionText, questionNumber: _questionNumber, tags: _tags }: QuestionCardProps) {
  return (
    <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-5 w-full">
      <p className="font-bold text-[22px] text-left leading-relaxed text-ink">
        {questionText}
      </p>
    </div>
  );
}

