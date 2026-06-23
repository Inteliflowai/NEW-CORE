// src/components/core/GradeTrendSparkline.tsx
// Shared dated grade-over-time sparkline (you vs your own past, never peer-relative).
// Pure SVG line; token colors via CSS vars (matches GrowthMotif). No animation → reduced-motion-safe.
// Caller supplies aria-label (teacher surfaces may include grade digits). <2 points → calm cold-start.
import React from 'react';

export interface GradeTrendSparklineProps {
  points: { date: string; grade: number; label?: string }[];
  ariaLabel: string;
  size?: 'sm' | 'md';
  coldStartLabel?: string;
}

const MIN_POINTS = 2;

export function GradeTrendSparkline({
  points,
  ariaLabel,
  size = 'md',
  coldStartLabel = 'Not enough yet to show a trend.',
}: GradeTrendSparklineProps): React.JSX.Element {
  if (points.length < MIN_POINTS) {
    return (
      <p data-testid="trend-cold-start" className="text-fg-muted text-xs">
        {coldStartLabel}
      </p>
    );
  }

  const W = size === 'sm' ? 180 : 320;
  const H = size === 'sm' ? 44 : 68;
  const PAD = 5;
  const grades = points.map(p => p.grade);
  const min = Math.min(...grades);
  const max = Math.max(...grades);
  const span = Math.max(1, max - min); // guard divide-by-zero (flat line → mid-height)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (g: number) => PAD + (1 - (g - min) / span) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.grade).toFixed(1)}`).join(' ');
  const lastI = points.length - 1;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid="grade-trend-sparkline"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)' }}
    >
      <path d={d} fill="none" stroke="var(--brand-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(p.grade)}
          r={i === lastI ? 3.5 : 2}
          fill={i === lastI ? 'var(--brand)' : 'var(--brand-accent)'}
        >
          <title>{p.label ?? `${p.grade}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default GradeTrendSparkline;
