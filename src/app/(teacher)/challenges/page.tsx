// src/app/(teacher)/challenges/page.tsx
// Teacher-only Spark Challenges screen. Role gate is in (teacher)/layout.tsx; this page adds
// the object-level IDOR guard. Reads completions via the admin client (RLS-bypassed; guard is
// the backstop). Dignified cold-start when no challenges. Teacher surface — transfer % is allowed.
import React from 'react';

import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadChallenges } from '@/lib/spark/loadChallenges';
import { EmptyState } from '@/components/core/EmptyState';
import { ChallengeCard } from './_components/ChallengeCard';

const PICK_A_CLASS = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="Pick a class to begin"
    bodyOverride="Use the class selector above to see Spark Challenges."
  />
);

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) return <div className="p-6">{PICK_A_CLASS}</div>;

  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{PICK_A_CLASS}</div>;

  const admin = createAdminSupabaseClient();
  const { challenges } = await loadChallenges(admin, classId);

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-2xl text-fg font-semibold">Spark Challenges</h1>
      </div>

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
