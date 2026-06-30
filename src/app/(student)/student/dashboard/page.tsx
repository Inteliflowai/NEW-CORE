import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { Card } from '@/components/core/Card';
import { loadStudentNotesPaged } from '@/lib/highfives/loadStudentNotesPaged';
import { HighFiveNote } from './_components/HighFiveNote';
import { NextUpCard } from './_components/NextUpCard';

const PREVIEW_NOTES = 2;

type AsgRow = { id: string; content: { title?: string } | null };
type AttemptRow = { assignment_id: string };

export default async function StudentHome(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();

  // Notes preview + total count in one query
  const { notes, totalCount } = await loadStudentNotesPaged(admin, userId, 1, PREVIEW_NOTES);

  // Next unsubmitted assignment
  const { data: submitted } = await admin
    .from('homework_attempts')
    .select('assignment_id')
    .eq('student_id', userId)
    .in('status', ['submitted', 'graded']);
  const submittedIds = new Set(
    ((submitted ?? []) as AttemptRow[]).map((r) => r.assignment_id),
  );

  const { data: asgData } = await admin
    .from('assignments')
    .select('id, content')
    .eq('student_id', userId)
    .order('created_at', { ascending: true });

  const nextUp = ((asgData ?? []) as AsgRow[]).find((a) => !submittedIds.has(a.id)) ?? null;

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-fg text-xl font-semibold">Your CORE space</h1>

      {nextUp && (
        <NextUpCard id={nextUp.id} title={nextUp.content?.title ?? 'Assignment'} />
      )}

      {notes.length > 0 && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            {notes.map((n) => (
              <HighFiveNote key={n.id} text={n.note_text} />
            ))}
            {totalCount > PREVIEW_NOTES && (
              <Link
                href="/student/notes"
                className="text-brand text-xs underline self-start"
              >
                See all {totalCount} notes →
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
