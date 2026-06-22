// Server Component. Teacher-only (layout gates requireRole(['teacher'])). Quiet insights hub.
import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadInsights } from '@/lib/insights/loadInsights';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { SummaryCallout } from '../_components/SummaryCallout';
import { BandMix } from './_components/BandMix';
import { SkillsToFocus } from './_components/SkillsToFocus';

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, its trends show up here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

export default async function InsightsPage({
  searchParams,
}: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/insights?class=${firstId}`);
  }
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const data = await loadInsights(admin, { classId });

  if (data.band_mix.total === 0) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <PageHeader title="Insights" kicker="Trends on your class right now" accent="brand" />
        <EmptyState variant="just-getting-started"
          titleOverride="Not much to show yet"
          bodyOverride="Once your class has a little more activity, patterns will appear here." />
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Insights" kicker="Trends on your class right now" accent="brand" />
      {data.observation && <SummaryCallout>{data.observation}</SummaryCallout>}
      <BandMix mix={data.band_mix} />
      <SkillsToFocus gaps={data.concept_gaps} />
    </div>
  );
}
