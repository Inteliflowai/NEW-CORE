// src/app/(teacher)/roster/_components/ClassPulseStrip.tsx
// Server component — no 'use client'.
// Slim segmented mastery-mix bar + legend for the class pulse.
// Color is NEVER the sole carrier: each legend entry has color swatch + dot glyph + word + count.
// Tier-2 token classes only; WCAG-AA-safe pairs.

import React from 'react';

export interface PulseCounts {
  reteach: number;
  grade_level: number;
  advanced: number;
  not_assessed: number;
}

interface BandConfig {
  key: keyof PulseCounts;
  label: string;
  dot: string;
  swatchClass: string;
  textClass: string;
}

const BANDS: BandConfig[] = [
  {
    key: 'reteach',
    label: 'Building',
    dot: '●',
    swatchClass: 'bg-warn-surface',
    textClass: 'text-warn-fg',
  },
  {
    key: 'grade_level',
    label: 'On Track',
    dot: '●',
    swatchClass: 'bg-brand-surface',
    textClass: 'text-brand-fg',
  },
  {
    key: 'advanced',
    label: 'Strong',
    dot: '●',
    swatchClass: 'bg-ok-surface',
    textClass: 'text-ok-fg',
  },
  {
    key: 'not_assessed',
    label: 'Not yet assessed',
    dot: '○',
    swatchClass: 'bg-fg-muted',
    textClass: 'text-fg-muted',
  },
];

// Segment background colors for the bar (distinct from legend swatch colors)
const BAR_BG: Record<keyof PulseCounts, string> = {
  reteach: 'bg-warn-surface',
  grade_level: 'bg-brand-surface',
  advanced: 'bg-ok-surface',
  not_assessed: 'bg-fg-muted',
};

export function ClassPulseStrip({ counts }: { counts: PulseCounts }): React.JSX.Element {
  const total = counts.reteach + counts.grade_level + counts.advanced + counts.not_assessed;

  return (
    <div className="flex flex-col gap-2">
      {/* Segmented bar */}
      {total > 0 && (
        <div
          className="flex h-2 w-full overflow-hidden rounded-full"
          role="img"
          aria-label="Class mastery mix bar"
        >
          {BANDS.map(({ key, swatchClass }) => {
            const count = counts[key];
            if (count === 0) return null;
            const pct = (count / total) * 100;
            return (
              <div
                key={key}
                className={BAR_BG[key]}
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {BANDS.map(({ key, label, dot, swatchClass, textClass }) => {
          const count = counts[key];
          return (
            <div key={key} className="flex items-center gap-1">
              {/* Color swatch */}
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${swatchClass}`}
                aria-hidden="true"
              />
              {/* Dot glyph */}
              <span className={`text-xs ${textClass}`} aria-hidden="true">
                {dot}
              </span>
              {/* Word label + count */}
              <span className={`text-xs ${textClass}`}>
                {label}
              </span>
              <span className="text-xs text-fg tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ClassPulseStrip;
