import React from 'react';

/** Shape of a chapter-test section row (mirrors the DB / API contract). */
export interface SectionData {
  id: string;
  section_order: number;
  section_kind: string;
  title: string;
  time_minutes: number;
  total_points: number;
  power_skill: string | null;
}

export interface SectionCardProps {
  section: SectionData;
  /** True when this is the student's currently-active section. */
  isActive: boolean;
  children: React.ReactNode;
}

/**
 * Section container shown inside the chapter test player.
 *
 * Active state uses `bg-brand-surface`; inactive uses `bg-surface`.
 * All styling is token-only — no hardcoded hex.
 */
export function SectionCard({ section, isActive, children }: SectionCardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-surface p-4 space-y-4',
        isActive ? 'bg-brand-surface' : 'bg-surface',
      ].join(' ')}
    >
      {/* Section header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-fg font-display font-bold text-base leading-snug">
            {section.title}
          </h2>
          {section.power_skill != null && (
            <p className="text-fg-muted text-sm mt-0.5">{section.power_skill}</p>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-fg-muted shrink-0 whitespace-nowrap">
          <span>{section.time_minutes} min</span>
          <span aria-hidden>·</span>
          <span>{section.total_points} pts</span>
        </div>
      </div>

      {/* Section questions */}
      <div className="space-y-6">{children}</div>
    </div>
  );
}
