'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { COACH_MOTION, coachContainerVariants, coachMarkVariants, coachRiseVariants, coachSparkVariants } from '@/lib/design/coachMotion';

export function HighFiveNote({ text }: { text: string }): React.JSX.Element {
  const reduce = useReducedMotion();
  const cfg = COACH_MOTION.student;
  return (
    <motion.div variants={coachContainerVariants(!!reduce, cfg)} initial="hidden" animate="show" className="flex items-start gap-2">
      <motion.div
        variants={coachMarkVariants(!!reduce, cfg)}
        aria-hidden="true"
        className="relative grid size-8 shrink-0 place-items-center rounded-full border-2 border-sidebar-edge bg-brand font-display font-extrabold text-fg-on-brand shadow-sticker"
      >
        ★
        {cfg.celebratory && (
          <motion.span
            variants={coachSparkVariants(!!reduce)}
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border-2 border-sidebar-edge bg-sidebar-active text-[9px] text-sidebar-active-fg shadow-sticker"
          >
            ✦
          </motion.span>
        )}
      </motion.div>
      <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg text-base leading-relaxed">{text}</motion.p>
    </motion.div>
  );
}
export default HighFiveNote;
