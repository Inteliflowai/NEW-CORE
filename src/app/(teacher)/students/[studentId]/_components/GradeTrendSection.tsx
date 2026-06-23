'use client';
// Student profile "Grades over time" — fuller (md) grade sparkline. Teacher-only (earned grades).
// Distinct from the rail's "Growing" snapshot card: this is assignment-by-assignment, by graded date.
import React from 'react';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { SectionLabel } from '../../../_components/SectionLabel';
import type { StudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';

function directionPhrase(d: StudentGradeTrend['direction']): string {
  if (d === 'climbing') return 'Climbing across recent assignments.';
  if (d === 'sliding') return 'Slipping a little across recent assignments.';
  if (d === 'steady') return 'Holding steady across recent assignments.';
  return '';
}

export function GradeTrendSection({ trend, studentName }: { trend: StudentGradeTrend; studentName: string }): React.JSX.Element {
  const phrase = directionPhrase(trend.direction);
  return (
    <section className="flex flex-col gap-2">
      <h2><SectionLabel tone="brand">Grades over time</SectionLabel></h2>
      {phrase && <p className="text-fg text-[13px] leading-snug">{phrase}</p>}
      <GradeTrendSparkline
        size="md"
        points={trend.points.map((p) => ({ date: p.date, grade: p.grade, label: `${p.assignment_title} · ${p.grade}%` }))}
        ariaLabel={`${studentName}'s grades over time${trend.latest != null ? `, latest ${trend.latest} percent` : ''}`}
        coldStartLabel="Not enough graded work yet to show a trend."
      />
    </section>
  );
}

export default GradeTrendSection;
