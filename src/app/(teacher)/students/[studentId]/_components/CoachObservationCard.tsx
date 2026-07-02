'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../../_components/SectionLabel';
import {
  COACH_MOTION,
  coachContainerVariants,
  coachMarkVariants,
  coachRiseVariants,
} from '@/lib/design/coachMotion';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';

type CoachRead = StudentSignals['coach_read'];

interface CoachObservationCardProps {
  coach: CoachRead;
  /** Optional evidence anchor/href (e.g. '#quiz-detail' or '#skill-map'); null/absent renders no link. */
  evidenceHref?: string | null;
}

export function CoachObservationCard({ coach, evidenceHref }: CoachObservationCardProps): React.JSX.Element {
  const reduce = useReducedMotion();
  const cfg = COACH_MOTION.teacher;
  return (
    <motion.div id="at-risk" initial="hidden" animate="show" variants={coachContainerVariants(!!reduce, cfg)}>
      <Card tone={coach.tone}>
        <motion.div variants={coachMarkVariants(!!reduce, cfg)} className="mb-2">
          <SectionLabel tone={coach.tone}>{coach.eyebrow}</SectionLabel>
        </motion.div>
        <div className="flex flex-col gap-1.5">
          <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg text-[13px]">{coach.line}</motion.p>
          {coach.suggestion && (
            <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg text-[13px]">{coach.suggestion}</motion.p>
          )}
        </div>
        {evidenceHref && (
          <a
            href={evidenceHref}
            className="mt-2 inline-block text-sm font-semibold text-brand hover:underline"
          >
            See what&apos;s behind this →
          </a>
        )}
      </Card>
    </motion.div>
  );
}

export default CoachObservationCard;
