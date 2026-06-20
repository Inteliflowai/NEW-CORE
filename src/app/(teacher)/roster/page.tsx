// src/app/(teacher)/roster/page.tsx
// Server Component — async. Teacher-only (layout already gates requireRole(['teacher'])).
// Auth chain: guardClassAccess (IDOR) → admin client → loadRosterSignals.
// NEVER renders risk_score, raw question_text (skill_id), or pct_incorrect directly.
// Token-only styling; deep-ink content text (text-fg); no hardcoded hex.

import React from 'react';

import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { sortFocusGroup } from '@/lib/signals/sortFocusGroup';
import { EmptyState } from '@/components/core/EmptyState';

import { RosterTriageCard } from './_components/RosterTriageCard';
import { ClassPulseStrip } from './_components/ClassPulseStrip';
import type { PulseCounts } from './_components/ClassPulseStrip';
import { EveryoneElseDisclosure } from './_components/EveryoneElseDisclosure';
import { ConceptGapsRail } from './_components/ConceptGapsRail';
import { SignalLegend } from './_components/SignalLegend';

// ── Pick-a-class fallback (reused in two early returns) ───────────────────────
const PICK_A_CLASS = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="Pick a class to begin"
    bodyOverride="Use the class selector above to see your roster."
  />
);

// ── Summary sentence (singular/plural aware; deep-ink) ─────────────────────────
function buildSummary(needs: number, onTrack: number, notAssessed: number): string {
  if (needs === 0) return "Nothing urgent today — everyone's tracking along.";

  const needsPart =
    needs === 1
      ? '1 student needs a closer look today'
      : `${needs} students need a closer look today`;

  const onTrackPart =
    onTrack === 1 ? '1 is on track' : `${onTrack} are on track`;

  const notAssessedPart =
    notAssessed === 1
      ? "1 hasn't been assessed yet"
      : `${notAssessed} haven't been assessed yet`;

  return `${needsPart}, ${onTrackPart}, and ${notAssessedPart}.`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  // 1. Resolve classId from searchParams
  const { class: classId } = await searchParams;

  if (!classId) {
    return <div className="p-6">{PICK_A_CLASS}</div>;
  }

  // 2. IDOR guard — teacher must own the class
  const guard = await guardClassAccess(classId);
  if (guard) {
    // Can't return a NextResponse from a page — render the select-a-class state instead
    return <div className="p-6">{PICK_A_CLASS}</div>;
  }

  // 3. Load signals via admin client (RLS-bypassed; guard above is the backstop)
  const admin = createAdminSupabaseClient();
  const data = await loadRosterSignals(admin, classId);

  // 4. Build rosterById lookup (student_id → RosterItem)
  const rosterById = Object.fromEntries(data.roster.map((r) => [r.student_id, r]));

  // 5. Derive counts
  const needs = data.focus_group.length;
  const notAssessed = data.roster.filter((r) => r.band === null).length;
  const onTrack = Math.max(0, data.roster.length - needs - notAssessed);

  const summary = buildSummary(needs, onTrack, notAssessed);

  // 6. Sort focus group and handle rough-week cap (>6 → show 6 + overflow note)
  const focusSorted = sortFocusGroup(data.focus_group);
  const FOCUS_CAP = 6;
  const focusVisible = focusSorted.slice(0, FOCUS_CAP);
  const focusOverflow = focusSorted.length > FOCUS_CAP ? focusSorted.length - FOCUS_CAP : 0;

  // 7. Compute pulse counts from band distribution
  const pulseCounts: PulseCounts = {
    reteach: data.roster.filter((r) => r.band === 'reteach').length,
    grade_level: data.roster.filter((r) => r.band === 'grade_level').length,
    advanced: data.roster.filter((r) => r.band === 'advanced').length,
    not_assessed: notAssessed,
  };

  // Everyone else = roster minus the focus_group student_ids
  const focusIds = new Set(data.focus_group.map((f) => f.student_id));
  const others = data.roster.filter((r) => !focusIds.has(r.student_id));

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Part 1 — Header */}
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-2xl text-fg font-semibold">Roster</h1>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left column — Parts 2–5 */}
        <div className="flex flex-1 flex-col gap-6">
          {/* Part 2 — Calm-glance summary */}
          <p className="text-fg text-sm">{summary}</p>

          {/* Part 3 — Class pulse strip */}
          <ClassPulseStrip counts={pulseCounts} />

          {/* Part 4 — "Needs you today" stack */}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-base text-fg font-semibold">
              Needs you today
            </h2>

            {focusVisible.length === 0 ? (
              <p className="text-fg-muted text-sm">No students need immediate attention.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {focusVisible.map((item) => (
                  <RosterTriageCard
                    key={item.student_id}
                    item={item}
                    rosterById={rosterById}
                    classId={classId}
                  />
                ))}
                {focusOverflow > 0 && (
                  <p className="text-fg-muted text-sm mt-1">
                    +{focusOverflow} more need attention
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Part 5 — Everyone else (collapsed by default) */}
          <EveryoneElseDisclosure others={others} classId={classId} />

          {/* Signal legend */}
          <SignalLegend />
        </div>

        {/* Right rail — Part 6: Concept gaps */}
        <aside className="w-full lg:w-72 shrink-0">
          <ConceptGapsRail gaps={data.concept_gaps} />
        </aside>
      </div>
    </div>
  );
}
