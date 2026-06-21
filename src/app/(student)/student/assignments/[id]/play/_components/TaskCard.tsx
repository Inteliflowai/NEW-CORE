'use client';

/**
 * TaskCard — renders a single assignment task: its prompt (MathText) plus a
 * typed open-response textarea. Segment 1+2 is typed-only; the drawing canvas,
 * Teli tutor, hint ladder, and TTS land in later segments (the `image_url`
 * field already exists in the responses contract so the canvas slots in without
 * reshaping data). Token-only styling, mirrored from the quiz QuestionCard's
 * open-response treatment.
 */

import React, { useRef } from 'react';
import { MathText } from '@/components/core/MathText';

export interface TaskCardProps {
  step: number;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onFirstInput: () => void;
}

export function TaskCard({ step, description, value, onChange, onFirstInput }: TaskCardProps) {
  const hasInputtedRef = useRef(false);

  function fireFirstInput() {
    if (!hasInputtedRef.current) {
      hasInputtedRef.current = true;
      onFirstInput();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-fg-on-brand text-sm font-bold">
          {step}
        </span>
        <div className="text-fg text-base leading-relaxed font-medium pt-0.5">
          <MathText>{description}</MathText>
        </div>
      </div>

      <textarea
        rows={6}
        value={value}
        onChange={(e) => {
          fireFirstInput();
          onChange(e.target.value);
        }}
        onFocus={fireFirstInput}
        placeholder="Write your answer here…"
        style={{ resize: 'vertical' }}
        className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base
                   focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30
                   placeholder:text-fg-muted"
        aria-label={`Answer for question ${step}`}
      />
    </div>
  );
}

export default TaskCard;
