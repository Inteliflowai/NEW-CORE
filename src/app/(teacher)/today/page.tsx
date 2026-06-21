// src/app/(teacher)/today/page.tsx
// Server Component — async. Teacher-only (layout already gates requireRole(['teacher'])).
// Auth chain: guardClassAccess (IDOR) → admin client → loadRosterSignals.
// NEVER renders risk_score, raw question_text (skill_id), or diagnosis.diagnosis directly.
// Token-only styling; deep-ink content text (text-fg); no hardcoded hex.
//
// Active-class resolution: when ?class= is absent we default to the teacher's
// first class server-side (firstClassIdForTeacher) and redirect — so the screen
// never flashes a "pick a class" state before the client switcher writes ?class=.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { sortFocusGroup } from '@/lib/signals/sortFocusGroup';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { SummaryCallout } from '../_components/SummaryCallout';
import { NeedsYouCard } from './_components/NeedsYouCard';
import { WinsCard } from './_components/WinsCard';
import { QuickStartCard } from './_components/QuickStartCard';
import { ConceptGapsRail } from '../roster/_components/ConceptGapsRail';

const NO_CLASSES = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, your day starts here."
  />
);

const CLASS_UNAVAILABLE = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes."
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
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) {
      return <div className="p-6">{NO_CLASSES}</div>;
    }
    redirect(`/today?class=${firstId}`);
  }

  const guard = await guardClassAccess(classId);
  if (guard) {
    return <div className="p-6">{CLASS_UNAVAILABLE}</div>;
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
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Today" kicker="Your class at a glance" accent="brand" />
      <SummaryCallout>{summary}</SummaryCallout>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <NeedsYouCard focusGroup={focusSorted} classId={classId} />
        <WinsCard roster={winsRoster} />
        <QuickStartCard classId={classId} />
      </div>
      {/* Quiet on good days: only surface class-wide gaps when there are any.
          Roster keeps its own always-present rail as the dedicated triage surface. */}
      {data.concept_gaps.length > 0 && <ConceptGapsRail gaps={data.concept_gaps} />}
    </div>
  );
}
