// src/app/(teacher)/today/page.tsx
// Server Component — async. Teacher-only (layout already gates requireRole(['teacher'])).
// Auth chain: guardClassAccess (IDOR) → admin client → loadRosterSignals.
// NEVER renders risk_score, raw question_text (skill_id), or diagnosis.diagnosis directly.
// Token-only styling; deep-ink content text (text-fg); no hardcoded hex.

import React from 'react';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { sortFocusGroup } from '@/lib/signals/sortFocusGroup';
import { EmptyState } from '@/components/core/EmptyState';
import { NeedsYouCard } from './_components/NeedsYouCard';
import { WinsCard } from './_components/WinsCard';
import { QuickStartCard } from './_components/QuickStartCard';

const PICK_A_CLASS = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="Pick a class to begin"
    bodyOverride="Use the class selector above to see today's overview."
  />
);

function buildSummary(needs: number, onTrack: number, notAssessed: number): string {
  if (needs === 0) return "Nothing urgent today — everyone's tracking along.";
  const needsPart =
    needs === 1
      ? '1 student needs a closer look today'
      : `${needs} students need a closer look today`;
  const onTrackPart = onTrack === 1 ? '1 is on track' : `${onTrack} are on track`;
  const notAssessedPart =
    notAssessed === 1
      ? "1 hasn't been assessed yet"
      : `${notAssessed} haven't been assessed yet`;
  return `${needsPart}, ${onTrackPart}, and ${notAssessedPart}.`;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;

  if (!classId) {
    return <div className="p-6">{PICK_A_CLASS}</div>;
  }

  const guard = await guardClassAccess(classId);
  if (guard) {
    return <div className="p-6">{PICK_A_CLASS}</div>;
  }

  const admin = createAdminSupabaseClient();
  const data = await loadRosterSignals(admin, classId);

  const needs = data.focus_group.length;
  const notAssessed = data.roster.filter((r) => r.band === null).length;
  const onTrack = Math.max(0, data.roster.length - needs - notAssessed);

  const summary = buildSummary(needs, onTrack, notAssessed);
  const focusSorted = sortFocusGroup(data.focus_group);

  // Wins celebrates only students who are NOT in the "needs you" group, so its
  // count stays consistent with the summary's on-track number (a focus-group
  // student is never also "on track or stronger").
  const focusIds = new Set(focusSorted.map((f) => f.student_id));
  const winsRoster = data.roster.filter((r) => !focusIds.has(r.student_id));

  return (
    <div className="p-6 flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-fg font-semibold">Today</h1>
      </div>
      <p className="text-fg text-sm">{summary}</p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <NeedsYouCard focusGroup={focusSorted} classId={classId} />
        <WinsCard roster={winsRoster} />
        <QuickStartCard classId={classId} />
      </div>
    </div>
  );
}
