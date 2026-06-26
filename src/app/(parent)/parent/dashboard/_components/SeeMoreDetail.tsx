'use client';
/**
 * SeeMoreDetail — a <details> collapse showing digit-free growth + read-only high-fives.
 *
 * C1 (defense-in-depth): every high-five note is run through hasParentLeak at
 * render time; any that leaks is DROPPED before it reaches the DOM.
 * loadStudentHighFivesReadonly already filters at load time; this is the final
 * render-time wall.
 *
 * C3: the sparkline points passed here MUST carry a digit-free `label`
 * (the caller supplies topic words or ''). The `${p.grade}%` fallback in
 * GradeTrendSparkline's <title> must NEVER fire — the label is always provided.
 * The ariaLabel passed to GradeTrendSparkline contains NO digits.
 *
 * Token-only styling; no hardcoded hex. DRAFT copy → Barb.
 */
import React from 'react';
import { hasParentLeak } from '@/lib/copy/parentGuard';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { GrowthMotif } from '@/components/core/GrowthMotif';
import type { ParentHighFive } from '@/lib/parent/loadStudentHighFivesReadonly';

// The sparkline point type — label is REQUIRED here (not optional) to enforce C3.
export interface DigitFreeSparklinePoint {
  date: string;
  /** The raw grade value used to position the dot — NEVER shown as text. */
  grade: number;
  /** Digit-free label; use the topic word or '' — never leave undefined (C3). */
  label: string;
}

export interface SeeMoreDetailProps {
  highFives: ParentHighFive[];
  /** Normalized 0–1 score series for GrowthMotif bars (≥4 for non-cold-start).
   *  Raw scores are never passed here — they are normalized server-side and do
   *  not appear in client props (M7). */
  growthHistory: number[];
  /** ≥2 points for the sparkline to render; each point MUST have a digit-free label. */
  sparklinePoints: DigitFreeSparklinePoint[];
  gradeTrendDirection: 'climbing' | 'steady' | 'sliding' | null;
}

const DIRECTION_LABEL: Record<NonNullable<SeeMoreDetailProps['gradeTrendDirection']>, string> = {
  climbing: 'Building momentum',
  steady: 'Keeping a steady pace',
  sliding: 'A moment to pay extra attention',
};

export function SeeMoreDetail({
  highFives,
  growthHistory,
  sparklinePoints,
  gradeTrendDirection,
}: SeeMoreDetailProps): React.JSX.Element {
  // C1: render-time filter — drop any high-five note that triggers parentLeaks
  const safeHighFives = highFives.filter((hf) => !hasParentLeak(hf.note));

  // C3: digit-free aria-label for the sparkline (no numbers, no %)
  const sparklineAriaLabel = gradeTrendDirection
    ? DIRECTION_LABEL[gradeTrendDirection]
    : "Growth over time";

  // C3: ensure every sparkline point has a digit-free label (never fall through to `${grade}%`)
  const safePoints: { date: string; grade: number; label: string }[] = sparklinePoints.map(
    (p) => ({
      date: p.date,
      grade: p.grade,
      label: p.label !== '' ? p.label : 'activity',
    }),
  );

  return (
    <details className="group rounded-xl bg-surface overflow-hidden">
      <summary className="flex items-center justify-between px-5 py-4 cursor-pointer list-none select-none text-fg text-sm font-medium hover:bg-surface-alt transition-colors">
        <span>See growth details &amp; celebrations</span>
        <span
          aria-hidden="true"
          className="text-fg-muted text-xs group-open:rotate-180 transition-transform duration-200"
        >
          ▾
        </span>
      </summary>

      <div className="px-5 pb-5 flex flex-col gap-5">
        {/* Digit-free growth section */}
        <section aria-label="Growth over time" className="flex flex-col gap-3">
          <h3 className="text-fg text-xs font-semibold uppercase tracking-wide">
            {gradeTrendDirection ? DIRECTION_LABEL[gradeTrendDirection] : 'Growth over time'}
          </h3>

          {/* GrowthMotif bars — score values never rendered as text */}
          <GrowthMotif history={growthHistory} />

          {/* CS-4: Gate the sparkline on ≥4 points so it stays in sync with
               GrowthMotif's COLD_START_THRESHOLD — avoids drawing a trend line
               while GrowthMotif is still showing "just getting started". */}
          {growthHistory.length >= 4 && (
            <GradeTrendSparkline
              points={safePoints}
              ariaLabel={sparklineAriaLabel}
              size="sm"
              coldStartLabel="Just getting started — more to show soon."
            />
          )}
        </section>

        {/* Read-only high-fives */}
        {safeHighFives.length > 0 && (
          <section aria-label="Recent celebrations" className="flex flex-col gap-2">
            <h3 className="text-fg text-xs font-semibold uppercase tracking-wide">
              Recent celebrations
            </h3>
            <ul className="flex flex-col gap-2">
              {safeHighFives.map((hf) => (
                <li key={hf.id} className="text-fg text-sm leading-relaxed">
                  <span aria-hidden="true" className="text-brand mr-1.5">✦</span>
                  {hf.note}
                </li>
              ))}
            </ul>
          </section>
        )}

        {safeHighFives.length === 0 && (
          <p className="text-fg-muted text-sm leading-relaxed">
            Celebrations will appear here as they are added.
          </p>
        )}
      </div>
    </details>
  );
}

export default SeeMoreDetail;
