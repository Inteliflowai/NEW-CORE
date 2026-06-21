'use client';

/**
 * TaskRail — the top progress rail for the assignment player. One dot per task;
 * answered tasks read 'ok', the active task is wide/brand, untouched tasks are a
 * neutral outline. Mirrors the quiz runner's progress dots (token-only). Lets the
 * student jump to any answered task or any task at-or-before the current one.
 */

import React from 'react';

export interface TaskRailProps {
  steps: number[];
  currentIndex: number;
  answered: Record<number, boolean>;
  onJump: (index: number) => void;
}

export function TaskRail({ steps, currentIndex, answered, onJump }: TaskRailProps) {
  return (
    <div
      className="sticky top-0 z-10 bg-bg border-b-2 border-surface px-4 py-3 flex items-center justify-between gap-4 shadow-sticker"
    >
      <div className="flex items-center gap-2 text-fg-muted text-sm font-medium">
        <span>{currentIndex + 1}</span>
        <span>/</span>
        <span>{steps.length}</span>
      </div>

      <div className="flex gap-1.5 flex-wrap justify-end">
        {steps.map((step, i) => {
          const isActive = i === currentIndex;
          const isAnswered = answered[step] === true;
          return (
            <button
              key={step}
              type="button"
              onClick={() => {
                if (isAnswered || i <= currentIndex) onJump(i);
              }}
              aria-label={`Question ${i + 1}`}
              aria-current={isActive ? 'true' : undefined}
              className={[
                'h-2 rounded-full transition-all duration-150',
                isActive ? 'w-6 bg-brand' : isAnswered ? 'w-2 bg-ok' : 'w-2 bg-surface border border-fg-muted',
              ].join(' ')}
            />
          );
        })}
      </div>
    </div>
  );
}

export default TaskRail;
