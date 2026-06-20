// src/app/(teacher)/students/[studentId]/_components/SkillMapMatrix.tsx
// TEACHER-ONLY. The right-column "Skill Map" matrix: one row per skill.
// 'use client' for the "show all" disclosure of the calm On-Track/Enrich tail.
//
// Leak discipline:
//   - skill_name only (via MathText) — the opaque skill_id is NEVER rendered.
//   - CLBadge uses the confidenceWord prop (soft word), never a raw number.
//   - misconception sub-line via misconceptionPhrase (warn tone), joined by skill_id
//     in the parent — the skill_id itself never reaches the DOM.
//   - per-row actions are DEFERRED (rendered, disabled-looking, no write).
// Tokens only; content text text-fg; eyebrow/meta text-fg-muted.
'use client';

import React, { useState } from 'react';
import { CLBadge, type ConfidenceWord } from '@/components/core/CLBadge';
import { MathText } from '@/components/core/MathText';
import type { PerSkillCL } from '@/lib/signals/loadStudentSignals';
import { skillTone, sortSkillMap, isTailRow, type SkillMapTone } from '../_lib/skillMapOrder';

export interface SkillMapRow extends PerSkillCL {
  /** Humanized misconception sub-line (already joined by skill_id upstream), or null. */
  misconception: string | null;
}

interface SkillMapMatrixProps {
  rows: SkillMapRow[];
}

// Left color-rail by tone (Tier-2 token classes only).
const RAIL_BY_TONE: Record<SkillMapTone, string> = {
  reinforce: 'bg-warn',
  'on-track': 'bg-ok',
  enrich: 'bg-brand',
  'not-yet': 'bg-fg-muted',
};

// Faint card wash by tone — colour-codes each skill at a glance (teacher surface).
const SURFACE_BY_TONE: Record<SkillMapTone, string> = {
  reinforce: 'bg-warn-surface',
  'on-track': 'bg-ok-surface',
  enrich: 'bg-brand-surface',
  'not-yet': 'bg-surface',
};

// Per-row deferred action label by tone.
const ACTION_BY_TONE: Partial<Record<SkillMapTone, string>> = {
  reinforce: 'Flag for reteach',
  enrich: 'Extend',
};

function confidenceWordOf(label: PerSkillCL['confidence_label']): ConfidenceWord | null {
  return label === 'consistent' || label === 'tentative' || label === 'emerging' ? label : null;
}

function SkillRow({ row }: { row: SkillMapRow }) {
  const tone = skillTone(row.cl_verb);
  const actionLabel = ACTION_BY_TONE[tone] ?? 'Note';

  return (
    <div className={`flex overflow-hidden rounded-lg border-2 border-sidebar-edge shadow-sticker ${SURFACE_BY_TONE[tone]}`}>
      <div className={`w-2 shrink-0 ${RAIL_BY_TONE[tone]}`} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-fg font-semibold flex-1 text-sm">
            <MathText>{row.skill_name}</MathText>
          </span>
          <CLBadge state={row.state} confidenceWord={confidenceWordOf(row.confidence_label)} />
          {/* Deferred per-row action — rendered but no write wired. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="rounded border border-fg-muted px-2 py-0.5 text-xs text-fg-muted opacity-60"
          >
            {actionLabel}
          </button>
        </div>
        {row.misconception && (
          <p className="text-warn-fg text-[13px] leading-snug">△ {row.misconception}</p>
        )}
      </div>
    </div>
  );
}

export function SkillMapMatrix({ rows }: SkillMapMatrixProps): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const sorted = sortSkillMap(rows);

  const head = sorted.filter((r) => !isTailRow(r.cl_verb));
  const tail = sorted.filter((r) => isTailRow(r.cl_verb));

  const visible = showAll ? sorted : head;

  if (sorted.length === 0) {
    return (
      <p className="text-fg-muted text-sm">No skills assessed yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2" id="skill-map">
      {visible.map((row) => (
        <SkillRow key={row.skill_id ?? row.skill_name} row={row} />
      ))}
      {tail.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex w-fit items-center gap-1 self-start rounded-md border-2 border-sidebar-edge bg-surface px-2.5 py-1 text-xs font-bold text-fg shadow-sticker transition-colors hover:bg-brand hover:text-fg-on-brand"
        >
          {showAll ? 'Show fewer ▴' : 'Show all on-track skills ▾'}
        </button>
      )}
    </div>
  );
}

export default SkillMapMatrix;
