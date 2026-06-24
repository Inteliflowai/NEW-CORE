'use client';

/**
 * ReadPhase — the first phase of the (untimed) assignment player.
 *
 * Shows the assignment title, any instructions, and the reading passage, with a
 * single "Ready to start" CTA that advances into the working (tasks) phase.
 * Untimed: there is NO timer here (the quiz runner's Begin/timer is deliberately
 * not ported). Token-only styling.
 */

import React from 'react';
import { Card } from '@/components/core/Card';
import { MathText } from '@/components/core/MathText';
import type { AssignmentContent } from '@/lib/assignments/loadAssignmentForPlay';
import ReadAloudButton from './ReadAloudButton';

export interface ReadPhaseProps {
  content: AssignmentContent;
  onStart: () => void;
  onTtsPlay?: () => void;
}

export function ReadPhase({ content, onStart, onTtsPlay }: ReadPhaseProps) {
  const title = content.title ?? 'Your Assignment';
  const instructions = content.instructions?.trim();
  const passage = content.reading_passage?.trim();
  const taskCount = content.tasks?.length ?? 0;

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center px-4 py-8">
      <Card tone="brand" className="max-w-2xl w-full flex flex-col gap-5 p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-fg">Assignment</p>
        <h1 className="font-display text-2xl text-fg font-bold leading-tight">
          <MathText>{title}</MathText>
        </h1>

        {instructions && (
          <p className="text-fg text-base leading-relaxed">
            <MathText>{instructions}</MathText>
          </p>
        )}

        {passage && (
          <div className="flex flex-col gap-2 rounded-lg border-2 border-surface bg-surface px-5 py-4">
            <ReadAloudButton text={content.audio_script || passage} onPlay={onTtsPlay} label="Listen" />
            <div className="text-fg text-sm leading-relaxed"><MathText>{passage}</MathText></div>
          </div>
        )}

        <p className="text-fg-muted text-sm">
          {taskCount === 1 ? 'There is 1 question to answer.' : `There are ${taskCount} questions to answer.`}{' '}
          Take your time — you can save and come back.
        </p>

        <button
          type="button"
          onClick={onStart}
          className="rounded-lg bg-brand text-fg-on-brand font-bold px-8 py-3 shadow-sticker hover:opacity-90 self-start"
        >
          Ready to start
        </button>
      </Card>
    </div>
  );
}

export default ReadPhase;
