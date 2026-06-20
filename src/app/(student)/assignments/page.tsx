// src/app/(student)/assignments/page.tsx
// Student assignment list. Role gate in (student)/layout.tsx (requireRole(['student'])).
// Four-audience: no scores, rubric dims, mastery bands, or risk numbers shown.
// Shows assignment title + "Spark Challenge" badge when spark_status !== 'none'.
import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentAssignments } from '@/lib/spark/loadStudentAssignments';
import { EmptyState } from '@/components/core/EmptyState';

export default async function StudentAssignmentsPage(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const rows = await loadStudentAssignments(admin, userId);

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">My Assignments</h1>
      {rows.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="No assignments yet"
          bodyOverride="New assignments from your teacher will show up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/student/assignments/${r.id}`}
              className="flex items-center justify-between gap-4 rounded border border-surface bg-surface px-4 py-3"
            >
              <span className="text-fg text-sm font-semibold">{r.title}</span>
              {r.sparkStatus !== 'none' && (
                <span className="text-brand text-xs font-bold">Spark Challenge</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
