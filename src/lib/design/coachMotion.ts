// The signature four-beat (NOTICE → SPEAK → INVITE → DEFER) as reusable,
// token-sourced framer-motion variant builders. Every coach surface inherits
// its motion from here; nothing hardcodes a duration/easing/spring. See
// FEEL-DIRECTION.md (the motion SoT) and tokens.motion (the values).
import type { Transition, Variants } from 'framer-motion';
import { motion as MT, type Cubic } from '@/lib/design/tokens';

export type CoachRegisterKey = 'student' | 'teacher' | 'parent';

export interface CoachMotionConfig {
  /** coach-mark "lean-in" transition (NOTICE). */
  entrance: Transition;
  /** line/invite "rise" transition (SPEAK / INVITE). */
  rise: { duration: number; ease: Cubic };
  /** delay between staggered beats. */
  stagger: number;
  /** student-only celebratory spark on SPEAK. */
  celebratory: boolean;
}

/** Per-register motion — same four-beat, three feelings (see FEEL-DIRECTION.md). */
export const COACH_MOTION: Record<CoachRegisterKey, CoachMotionConfig> = {
  student: {
    entrance: { ...MT.spring.playful },                  // a touch of bounce
    rise: { duration: MT.duration.base, ease: MT.ease.out },
    stagger: 0.14,
    celebratory: true,
  },
  teacher: {
    entrance: { duration: MT.duration.fast, ease: MT.ease.standard },  // fast, minimal — restraint is the romance
    rise: { duration: MT.duration.fast, ease: MT.ease.out },
    stagger: 0.08,
    celebratory: false,
  },
  parent: {
    entrance: { duration: MT.duration.slow, ease: MT.ease.out },        // gentle, soft
    rise: { duration: MT.duration.slow, ease: MT.ease.out },
    stagger: 0.18,
    celebratory: false,
  },
};

/** Reduced-motion → instant (snap to end state). */
export const coachTransition = (reduce: boolean, base: Transition): Transition =>
  reduce ? { duration: 0 } : base;

/** Stagger orchestrator + the DEFER exit (card eases away). */
export function coachContainerVariants(reduce: boolean, cfg: CoachMotionConfig): Variants {
  return {
    hidden: {},
    show: { transition: reduce ? {} : { staggerChildren: cfg.stagger, delayChildren: 0.05 } },
    defer: {
      opacity: 0, y: 28, scale: 0.97,
      transition: coachTransition(reduce, { duration: cfg.rise.duration, ease: MT.ease.exit }),
    },
  };
}

/** NOTICE — the coach-mark leans in and squares up. */
export function coachMarkVariants(reduce: boolean, cfg: CoachMotionConfig): Variants {
  return {
    hidden: { opacity: 0, x: -18, y: 6, rotate: -5, scale: 0.9 },
    show: { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, transition: coachTransition(reduce, cfg.entrance) },
  };
}

/** SPEAK / INVITE — the line and the action rise in. */
export function coachRiseVariants(reduce: boolean, cfg: CoachMotionConfig): Variants {
  return {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: coachTransition(reduce, cfg.rise) },
  };
}

/** Student-only earned spark on SPEAK. */
export function coachSparkVariants(reduce: boolean): Variants {
  return {
    hidden: { opacity: 0, scale: 0, rotate: -30 },
    show: {
      opacity: 1, scale: 1, rotate: 0,
      transition: coachTransition(reduce, { ...MT.spring.spark, delay: 0.1 }),
    },
  };
}
