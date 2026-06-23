import { describe, it, expect } from 'vitest';
import { motion as MT } from '@/lib/design/tokens';
import {
  COACH_MOTION,
  coachTransition,
  coachContainerVariants,
  coachStaggerVariants,
  coachMarkVariants,
  coachRiseVariants,
  coachSparkVariants,
} from '@/lib/design/coachMotion';

describe('coachMotion — token-sourced, reduced-motion-aware', () => {
  it('maps each register config to tokens.motion (no hardcoded values)', () => {
    expect(COACH_MOTION.teacher.rise.duration).toBe(MT.duration.fast);
    expect(COACH_MOTION.teacher.rise.ease).toBe(MT.ease.out);
    expect(COACH_MOTION.student.entrance).toMatchObject(MT.spring.playful);
    expect(COACH_MOTION.student.rise.duration).toBe(MT.duration.base);
    expect(COACH_MOTION.parent.rise.duration).toBe(MT.duration.slow);
    expect(COACH_MOTION.student.celebratory).toBe(true);
    expect(COACH_MOTION.teacher.celebratory).toBe(false);
  });

  it('coachTransition collapses to duration:0 under reduced motion', () => {
    expect(coachTransition(true, { duration: 0.45 })).toEqual({ duration: 0 });
    expect(coachTransition(false, { duration: 0.45 })).toEqual({ duration: 0.45 });
  });

  it('container drops the stagger under reduced motion', () => {
    const full = coachContainerVariants(false, COACH_MOTION.teacher);
    const reduced = coachContainerVariants(true, COACH_MOTION.teacher);
    expect((full.show as { transition: { staggerChildren: number } }).transition.staggerChildren)
      .toBe(COACH_MOTION.teacher.stagger);
    expect((reduced.show as { transition: object }).transition).toEqual({});
  });

  it('coach-mark hidden state is the lean-in (offset + tilt)', () => {
    const v = coachMarkVariants(false, COACH_MOTION.teacher);
    expect(v.hidden).toMatchObject({ opacity: 0, x: -18, rotate: -5, scale: 0.9 });
    expect(v.show).toMatchObject({ opacity: 1, x: 0, rotate: 0, scale: 1 });
  });

  it('rise hidden state is a y-offset fade', () => {
    const v = coachRiseVariants(false, COACH_MOTION.teacher);
    expect(v.hidden).toMatchObject({ opacity: 0, y: 14 });
    expect(v.show).toMatchObject({ opacity: 1, y: 0 });
  });

  it('spark snaps under reduced motion', () => {
    const v = coachSparkVariants(true);
    expect((v.show as { transition: { duration: number } }).transition.duration).toBe(0);
  });

  it('stagger-only variant drops the stagger under reduced motion', () => {
    const full = coachStaggerVariants(false, COACH_MOTION.student);
    const reduced = coachStaggerVariants(true, COACH_MOTION.student);
    expect((full.show as { transition: { staggerChildren: number } }).transition.staggerChildren)
      .toBe(COACH_MOTION.student.stagger);
    expect((reduced.show as { transition: object }).transition).toEqual({});
  });
});
