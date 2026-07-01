import React from 'react';
import { Card } from '@/components/core/Card';
import { hasParentLeak } from '@/lib/copy/parentGuard';

/** Surfaces the latest high-five note as a warm highlight. The note is
 *  teacher-authored for the student and already leak-filtered upstream by
 *  loadStudentHighFivesReadonly — the render-boundary hasParentLeak check is
 *  defense-in-depth (Global Constraint: guard AI-authored text at render).
 *  Hidden when there is no note, or if a leaky one somehow reaches here. */
export function CelebrateCard({ note }: { note: string | null }): React.JSX.Element | null {
  if (note == null || hasParentLeak(note)) return null;
  return (
    <Card tone="brand">
      <div className="flex flex-col gap-2">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Something your teacher wanted you to know</p>
        <p className="text-fg text-sm leading-relaxed">{note}</p>
      </div>
    </Card>
  );
}

export default CelebrateCard;
