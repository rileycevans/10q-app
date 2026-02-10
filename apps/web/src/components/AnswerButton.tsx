'use client';

export type AnswerFeedback = 'idle' | 'correct' | 'wrong';

interface AnswerButtonProps {
  text: string;
  isSelected?: boolean;
  feedback?: AnswerFeedback;
  onClick: () => void;
  disabled?: boolean;
}

export function AnswerButton({
  text,
  isSelected = false,
  feedback = 'idle',
  onClick,
  disabled = false,
}: AnswerButtonProps) {
  // Background color based on feedback state
  let bgColor = 'bg-white';
  if (feedback === 'correct') {
    bgColor = 'bg-green';
  } else if (feedback === 'wrong') {
    bgColor = 'bg-red';
  } else if (isSelected) {
    bgColor = 'bg-cyanA';
  }

  // Animation class based on feedback
  let animationClass = '';
  if (feedback === 'correct') {
    animationClass = 'animate-answer-pop';
  } else if (feedback === 'wrong') {
    animationClass = 'animate-answer-shake';
  }

  // Text color — white on red for contrast
  const textColor = feedback === 'wrong' ? 'text-white' : 'text-ink';

  return (
    <button
      className={`
        h-14 w-full border-[4px] border-ink rounded-[18px] shadow-sticker-sm
        font-bold text-lg text-center
        transition-colors duration-200 ease-out
        ${bgColor} ${textColor} ${animationClass}
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        ${feedback === 'idle' ? 'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]' : ''}
        focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2
      `}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Answer option: ${text}`}
      aria-pressed={isSelected}
    >
      {text}
      {isSelected && <span className="sr-only">Selected</span>}
    </button>
  );
}
