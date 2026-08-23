'use client';

import { motion, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import type { ReactNode } from 'react';

type TransitionPreset = 'slide-left' | 'slide-up' | 'fade' | 'scale-up' | 'zoom-reveal';

/**
 * Typed as concrete targets rather than Variants: Variants permits resolver
 * functions, which initial/animate do not accept when passed directly.
 */
interface Preset {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
}

const presets: Record<TransitionPreset, Preset> = {
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
  // Respect the OS setting. Motion sickness and vestibular disorders are the
  // reason it exists, and a transition on every screen is exactly the kind of
  // movement it is meant to suppress. Fade rather than nothing: content still
  // appears deliberately instead of snapping in.
  const reduceMotion = useReducedMotion();

  const variants = reduceMotion ? presets.fade : presets[preset];

  return (
    <motion.div
      // Object values rather than variant label strings ("initial"/"animate").
      // The label form renders the initial state and never animates out of it
      // here — the element keeps opacity:0 and its transform indefinitely,
      // which shows up as a permanently washed-out, offset screen. Passing the
      // values directly is what the rest of the app already does and it works.
      initial={variants.initial}
      animate={variants.animate}
      transition={{
        duration: reduceMotion ? 0.15 : duration,
        delay: reduceMotion ? 0 : delay,
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
