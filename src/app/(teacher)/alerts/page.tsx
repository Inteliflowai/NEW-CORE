import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { reconcileAlerts } from '@/lib/alerts/reconcileAlerts';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { SummaryCallout } from '../_components/SummaryCallout';
import { AlertsList } from './_components/AlertsList';

const NO_CLASSES = (<EmptyState variant="just-getting-started" titleOverride="No classes yet" bodyOverride="Once a class is set up for you, alerts show up here." />);
const CLASS_UNAVAILABLE = (<EmptyState variant="just-getting-started" titleOverride="That class isn't available" bodyOverride="Use the class selector to pick one of your classes." />);

function summary(urgent: number, watch: number): string {
  if (urgent === 0 && watch === 0) return 'Nothing new — the class is steady today.';
  const u = urgent === 1 ? '1 student needs attention' : `${urgent} students need attention`;
  const w = watch === 1 ? '1 to check in on' : `${watch} to check in on`;
  if (urgent === 0) return `${w}.`;
  if (watch === 0) return `${u}.`;
  return `${u}, ${w}.`;
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/alerts?class=${firstId}`);
  }
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const alerts = await reconcileAlerts(admin, { classId });
  const urgent = alerts.filter((a) => a.severity === 'urgent').length;
  const watch = alerts.filter((a) => a.severity === 'watch').length;

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Alerts" kicker="Things that just changed" accent="brand" />
      <SummaryCallout>{summary(urgent, watch)}</SummaryCallout>
      {alerts.length === 0
        ? <EmptyState variant="on-track" titleOverride="No new change events" bodyOverride="When something needs your eyes, it'll show up here." />
        : <AlertsList alerts={alerts} classId={classId} />}
    </div>
  );
}
