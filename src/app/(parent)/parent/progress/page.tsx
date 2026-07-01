// src/app/(parent)/parent/progress/page.tsx
// Parent Progress — calm grade trend + skill strengths + upcoming assignments.
// Auth chain mirrors the dashboard exactly (requireRole → children → validate
// ?child= → guardStudentAccess → redirect on deny). Four-audience: zero numbers.
import React from 'react';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/auth/requireRole';
import { guardStudentAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadParentChildren } from '@/lib/parent/loadParentChildren';
import { loadParentProgress } from '@/lib/parent/loadParentProgress';

import { ChildSelector } from '../dashboard/_components/ChildSelector';
import { TrendCard } from './_components/TrendCard';
import { UpcomingCard } from './_components/UpcomingCard';
import { StrengthsCard } from './_components/StrengthsCard';

export default async function ParentProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['parent']);
  const admin = createAdminSupabaseClient();
  const children = await loadParentChildren(admin, userId);

  if (children.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl bg-surface p-8 flex flex-col gap-3">
          <h1 className="font-display text-fg text-xl">Progress</h1>
          <p className="text-fg-muted text-sm leading-relaxed">
            Your child&apos;s progress will appear here once they are connected to your account.
          </p>
        </div>
      </div>
    );
  }

  const { child: childIdParam } = await searchParams;
  const selectedChild =
    childIdParam && children.some((c) => c.id === childIdParam)
      ? children.find((c) => c.id === childIdParam)!
      : children[0];
  const childId = selectedChild.id;

  const denied = await guardStudentAccess(childId);
  if (denied) redirect('/parent/progress');

  const data = await loadParentProgress(admin, childId);

  return (
    <div className="p-5 max-w-2xl mx-auto flex flex-col gap-5">
      {children.length > 1 && <ChildSelector children={children} selectedId={childId} />}

      <header>
        <h1 className="font-display text-fg text-xl">How {selectedChild.firstName} is doing</h1>
      </header>

      <TrendCard direction={data.gradeDirection} points={data.points} />
      <StrengthsCard firstName={selectedChild.firstName} strengths={data.strengths} />
      <UpcomingCard items={data.upcoming} />
    </div>
  );
}
