'use client';

// src/app/(teacher)/roster/_components/SignalLegend.tsx
// Client component — closed-by-default disclosure explaining band labels and action chips.
// Uses useState toggle (avoids jsdom <details>/<summary> limitations in tests).
// Token-only styling — no hardcoded hex, no arbitrary [var(--..)] values.

import React, { useState } from 'react';

const BAND_EXPLANATIONS = [
  {
    label: 'Building',
    description:
      "Students whose recent work shows they're still building this concept — they need another pass at the material.",
  },
  {
    label: 'On Track',
    description:
      'Students working solidly at grade level — a good place to be, with room to grow further.',
  },
  {
    label: 'Strong',
    description:
      'Students who have shown real mastery — they may benefit from extension or peer-teaching opportunities.',
  },
  {
    label: 'Not yet assessed',
    description:
      "Students who haven't completed enough recent practice for a reliable signal yet.",
  },
] as const;

const CHIP_EXPLANATIONS = [
  {
    label: 'reteach now',
    description:
      "The pattern suggests this student needs a fresh explanation, not just more practice. Consider a one-to-one or small-group reteach.",
  },
  {
    label: 'check in',
    description:
      'Something feels off — a quick verbal check could reveal whether the student is confused, disengaged, or just having an off day.',
  },
  {
    label: 'practice',
    description:
      'The concept is there but not fluent yet. More independent practice should consolidate it.',
  },
  {
    label: 'look closer',
    description:
      "There's an interesting or unusual pattern in this student's data worth exploring on the student detail page.",
  },
  {
    label: 'watch',
    description:
      "Nothing urgent, but keep an eye on this student's trajectory over the next few sessions.",
  },
] as const;

export function SignalLegend(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-surface pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="text-sm text-fg-muted hover:text-fg transition-colors"
      >
        What do these mean? {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-4 text-sm">
          {/* Band labels */}
          <div>
            <h3 className="text-fg font-semibold mb-2 text-xs uppercase tracking-wide">
              Mastery bands
            </h3>
            <ul className="flex flex-col gap-2">
              {BAND_EXPLANATIONS.map(({ label, description }) => (
                <li key={label} className="flex gap-2">
                  <span className="text-fg font-medium min-w-[7rem] shrink-0">{label}</span>
                  <span className="text-fg-muted leading-snug">{description}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Action chips */}
          <div>
            <h3 className="text-fg font-semibold mb-2 text-xs uppercase tracking-wide">
              Suggested actions
            </h3>
            <ul className="flex flex-col gap-2">
              {CHIP_EXPLANATIONS.map(({ label, description }) => (
                <li key={label} className="flex gap-2">
                  <span className="text-fg font-medium min-w-[7rem] shrink-0">{label}</span>
                  <span className="text-fg-muted leading-snug">{description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default SignalLegend;
