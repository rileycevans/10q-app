'use client';

interface AnswerButtonProps {
  text: string;
  isSelected?: boolean;
  isCorrect?: boolean | null; // null = no feedback yet, true = correct, false = incorrect
  onClick: () => void;
  disabled?: boolean;
}

export function AnswerButton({
  text,
  isSelected = false,
  isCorrect = null,
  onClick,
  disabled = false,
}: AnswerButtonProps) {
  // Determine background color based on state
  let bgColor = 'bg-white';
  if (isSelected) {
    if (isCorrect === true) {
      bgColor = 'bg-green';
    } else if (isCorrect === false) {
      bgColor = 'bg-red';
    } else {
      bgColor = 'bg-cyanA';
    }
  }

  // Text color: ink for contrast, or white if needed
  const textColor = isSelected && (isCorrect === true || isCorrect === false) ? 'text-ink' : 'text-ink';

  return (
    <button
      className={`
        h-14 w-full border-[4px] border-ink rounded-[18px] shadow-sticker-sm
        font-bold text-lg text-center
        transition-transform duration-[120ms] ease-out
        ${bgColor} ${textColor}
        ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]
        hover:-translate-x-[1px] hover:-translate-y-[1px]
        focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2
      `}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Answer option: ${text}`}
      aria-pressed={isSelected}
    >
      {text}
      {isSelected && (
        <span className="sr-only">
          {isCorrect === true ? 'Correct' : isCorrect === false ? 'Incorrect' : 'Selected'}
        </span>
      )}
    </button>
  );
}

