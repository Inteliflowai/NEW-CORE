// src/app/(parent)/parent/reports/page.tsx
//
// Listing page: shows each linked child with a link to their printable report.
// The layout already guards requireRole(['parent']); this page re-calls it to
// get userId (pattern matches dashboard page).

import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadParentChildren } from '@/lib/parent/loadParentChildren';

export default async function ParentReportsPage(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['parent']);

  const admin = createAdminSupabaseClient();
  const children = await loadParentChildren(admin, userId);

  if (children.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl bg-surface p-8 flex flex-col gap-3">
          <h1 className="font-display text-fg text-xl">Reports</h1>
          <p className="text-fg-muted text-sm leading-relaxed">
            Reports will appear here once your child is connected to your account.
            Reach out to their school to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="font-display text-fg text-xl">Reports</h1>
        <p className="text-fg-muted text-sm mt-1">
          A printable progress summary for each of your children.
        </p>
      </header>

      <ul className="flex flex-col gap-3" role="list">
        {children.map((child) => (
          <li key={child.id}>
            <a
              href={`/parent/children/${child.id}/report`}
              className="flex items-center justify-between rounded-xl bg-surface px-5 py-4 hover:bg-surface/80 transition-colors group"
            >
              <span className="font-medium text-fg">
                {child.firstName}&apos;s Progress Summary
              </span>
              <span
                aria-hidden="true"
                className="text-fg-muted text-xs group-hover:text-brand transition-colors"
              >
                View →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
