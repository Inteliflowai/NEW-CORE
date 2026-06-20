// src/app/(student)/assignments/[id]/page.tsx
// Student assignment detail page. Role gate in (student)/layout.tsx.
// Four-audience: student sees ONLY title + instructions + soft Spark status / launch card.
// NO transfer scores, rubric dims, mastery enums, CL verbs, or risk numbers.
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/core/EmptyState';
import { SparkLaunchCard } from './_components/SparkLaunchCard';

export default async function StudentAssignmentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();

  const { data: row } = await admin
    .from('assignments')
    .select('id, student_id, content, spark_status')
    .eq('id', id)
    .maybeSingle();

  // Missing row OR ownership mismatch → same EmptyState (don't leak existence)
  if (!row || row.student_id !== userId) {
    return (
      <div className="p-6">
        <EmptyState
          variant="just-getting-started"
          titleOverride="Assignment not found"
          bodyOverride="Head back to your assignments list."
        />
      </div>
    );
  }

  const content = (row.content ?? {}) as { title?: string; instructions?: string };
  const sparkStatus = (row.spark_status as string) ?? 'none';

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">
        {content.title ?? 'Assignment'}
      </h1>
      {content.instructions && (
        <p className="text-fg text-sm leading-relaxed">{content.instructions}</p>
      )}
      {sparkStatus !== 'none' && (
        <SparkLaunchCard assignmentId={row.id as string} sparkStatus={sparkStatus} />
      )}
    </div>
  );
}
