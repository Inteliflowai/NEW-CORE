import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { buildHighFiveSuggestions, type SuggestionInput } from '@/lib/highfives/suggestions';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { HighFiveComposer } from './_components/HighFiveComposer';

const NO_CLASSES = (<EmptyState variant="just-getting-started" titleOverride="No classes yet" bodyOverride="Once a class is set up for you, you can recognize students here." />);
const CLASS_UNAVAILABLE = (<EmptyState variant="just-getting-started" titleOverride="That class isn't available" bodyOverride="Use the class selector to pick one of your classes." />);

export default async function HighFivesPage({ searchParams }: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/high-fives?class=${firstId}`);
  }
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const roster = await loadRosterSignals(admin, classId);

  // recent high-fives (7d) → suppress repeat suggestions
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin.from('high_fives').select('student_id').eq('class_id', classId).gte('created_at', since);
  const recentSet = new Set((recent ?? []).map((r: { student_id: string }) => r.student_id));

  const inputs: SuggestionInput[] = roster.roster.map((r) => ({
    student_id: r.student_id, full_name: r.full_name, band: r.band,
    dominant_effort: null, trajectory: null, had_recent_reteach_win: false,
    recent_high_five: recentSet.has(r.student_id),
  }));
  const suggestions = buildHighFiveSuggestions(inputs);

  // Roster students for the blank-composer picker (lets the teacher write to anyone).
  const rosterStudents = roster.roster.map((r) => ({ student_id: r.student_id, full_name: r.full_name }));
  const nameById = new Map(rosterStudents.map((r) => [r.student_id, r.full_name]));

  // Last ~10 sent notes for the read-only "Recent" list.
  const { data: recentNotes } = await admin
    .from('high_fives')
    .select('student_id, note_text, created_at')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })
    .limit(10);
  const recentSent = ((recentNotes ?? []) as { student_id: string; note_text: string; created_at: string }[]).map((n) => ({
    student_id: n.student_id,
    full_name: nameById.get(n.student_id) ?? 'Student',
    note_text: n.note_text,
    created_at: n.created_at,
  }));

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="High Fives" kicker="Catch them doing something right" accent="lime" />
      <HighFiveComposer classId={classId} suggestions={suggestions} roster={rosterStudents} recent={recentSent} />
    </div>
  );
}
