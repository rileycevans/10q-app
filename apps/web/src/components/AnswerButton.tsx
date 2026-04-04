'use client';

import { motion } from 'framer-motion';

export type AnswerFeedback = 'idle' | 'committed' | 'correct' | 'wrong';

interface AnswerButtonProps {
  text: string;
  marker?: string;
  isSelected?: boolean;
  feedback?: AnswerFeedback;
  dimmed?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function AnswerButton({
  text,
  marker,
  isSelected = false,
  feedback = 'idle',
  dimmed = false,
  onClick,
  disabled = false,
}: AnswerButtonProps) {
  const isCommitted = feedback === 'committed';
  const isCorrect = feedback === 'correct';
  const isWrong = feedback === 'wrong';
  const isRevealed = isCorrect || isWrong;

  // Background color
  let bgColor = 'bg-white';
  if (isCorrect) bgColor = 'bg-green';
  else if (isWrong) bgColor = 'bg-red';
  else if (isCommitted) bgColor = 'bg-ink';

  // Text color
  let textColor = 'text-ink';
  if (isWrong || isCommitted) textColor = 'text-white';

  // Marker style — inverted during committed state
  let markerBg = 'bg-ink/10';
  let markerText = 'text-ink';
  if (isCommitted) {
    markerBg = 'bg-white/20';
    markerText = 'text-white';
  }

  return (
    <motion.button
      animate={
        isCorrect
          ? { scale: [1, 1.06, 0.97, 1.02, 1] }
          : isWrong
            ? { x: [0, -10, 10, -8, 8, -4, 4, 0] }
            : isCommitted
              ? { scale: [1, 0.96, 1] }
              : {}
      }
      transition={
        isRevealed
          ? { duration: 0.5, ease: 'easeOut' }
          : isCommitted
            ? { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
            : undefined
      }
      className={`
        relative overflow-hidden
        min-h-14 w-full px-5 py-3 border-[4px] rounded-[18px] shadow-sticker-sm
        font-bold text-lg text-left flex items-center
        ${feedback === 'idle' ? 'transition-colors duration-200 ease-out' : ''}
        ${bgColor} ${textColor}
        ${isCommitted ? 'border-ink shadow-[4px_4px_0_var(--ink)]' : 'border-ink'}
        ${dimmed ? 'opacity-40 scale-[0.97]' : 'opacity-100'}
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        ${feedback === 'idle' && !dimmed ? 'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]' : ''}
        focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-cyanA focus-visible:outline-offset-2
      `}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Answer option: ${text}`}
      aria-pressed={isSelected}
    >
      {marker && (
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold mr-3 shrink-0 transition-colors duration-200 ${markerBg} ${markerText}`}>
          {marker}
        </span>
      )}
      <span className="flex-1">{text}</span>

      {/* Shimmer overlay during committed state */}
      {isCommitted && (
        <motion.span
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <motion.span
            className="absolute top-0 bottom-0 w-[60%] bg-gradient-to-r from-transparent via-white/15 to-transparent"
            animate={{ left: ['-60%', '160%'] }}
            transition={{
              duration: 1,
              ease: 'easeInOut',
              repeat: Infinity,
              repeatDelay: 0.3,
            }}
          />
        </motion.span>
      )}

      {isCorrect && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 400, damping: 12 }}
          className="ml-2 text-xl"
          aria-hidden
        >
          ✓
        </motion.span>
      )}
      {isWrong && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 400, damping: 12 }}
          className="ml-2 text-xl text-white"
          aria-hidden
        >
          ✗
        </motion.span>
      )}
      {isSelected && feedback === 'idle' && <span className="sr-only">Selected</span>}
    </motion.button>
  );
}
