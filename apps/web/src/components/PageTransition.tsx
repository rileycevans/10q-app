'use client';

import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

type TransitionPreset = 'slide-left' | 'slide-up' | 'fade' | 'scale-up' | 'zoom-reveal';

const presets: Record<TransitionPreset, Variants> = {
  'slide-left': {
    initial: { opacity: 0, x: 60 },
    animate: { opacity: 1, x: 0 },
  },
  'slide-up': {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0 },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
  },
  'scale-up': {
    initial: { opacity: 0, scale: 0.85 },
    animate: { opacity: 1, scale: 1 },
  },
  'zoom-reveal': {
    initial: { opacity: 0, scale: 0.6 },
    animate: { opacity: 1, scale: 1 },
  },
};

interface PageTransitionProps {
  children: ReactNode;
  preset?: TransitionPreset;
  duration?: number;
  delay?: number;
  className?: string;
}

export function PageTransition({
  children,
  preset = 'fade',
  duration = 0.35,
  delay = 0,
  className,
}: PageTransitionProps) {
  const variants = presets[preset];

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={variants}
      transition={{
        duration,
        delay,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Stagger container — wrap children that each have their own motion */
export function StaggerContainer({
  children,
  staggerDelay = 0.06,
  delay = 0,
  className,
}: {
  children: ReactNode;
  staggerDelay?: number;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{
        initial: {},
        animate: {
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: delay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Individual stagger child */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
