// src/app/(teacher)/challenges/page.tsx
// Teacher-only Spark Challenges screen. Role gate is in (teacher)/layout.tsx; this page adds
// the object-level IDOR guard. Reads completions via the admin client (RLS-bypassed; guard is
// the backstop). Dignified cold-start when no challenges. Teacher surface — transfer % is allowed.
//
// Active-class resolution mirrors Today/Roster: default to the teacher's first
// class server-side when ?class= is absent, so the screen never flashes "pick a class".
import React from 'react';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadChallenges } from '@/lib/spark/loadChallenges';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { ChallengeCard } from './_components/ChallengeCard';

const NO_CLASSES = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, Spark Challenges appear here."
  />
);

const CLASS_UNAVAILABLE = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes."
  />
);

export default async function ChallengesPage({
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
    redirect(`/challenges?class=${firstId}`);
  }

  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const { challenges } = await loadChallenges(admin, classId);

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Spark Challenges" kicker="SPARK · inside CORE" accent="lime" />

      {challenges.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="No Spark Challenges yet"
          bodyOverride="Generate a SPARK-enabled assignment to start a challenge for this class."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {challenges.map((row) => (
            <ChallengeCard key={row.assignmentId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
