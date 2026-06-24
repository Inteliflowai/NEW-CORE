// src/app/(teacher)/import/page.tsx
// Server Component — async. Accessible to all staff roles (STAFF_ROLES).
// The (teacher) layout already gates requireRole(['teacher']); admins reach here through the same
// layout guard with a staff role — so we use requireRole(STAFF_ROLES) to cover both.
//
// Every staff member can run BOTH full (whole-school 5-sheet) and lean (single-class) imports.
// canLean requires a resolved classId. Classid resolution mirrors /upload exactly:
//   searchParams.class → firstClassIdForTeacher → redirect → guardClassAccess.
//
// If classId resolves to null (no classes) → NO_CLASSES empty state.
// If classId guard fails → CLASS_UNAVAILABLE empty state.
// canFull is always true for all staff roles.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { EmptyState } from '@/components/core/EmptyState';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { PageHeader } from '../_components/PageHeader';
import { RosterImportTabs } from './_components/RosterImportTabs';

const NO_CLASSES = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, you can import a roster here."
  />
);
const CLASS_UNAVAILABLE = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes."
  />
);

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  const { userId } = await requireRole(STAFF_ROLES);

  // Resolve classId the same way /upload does so lean mode has a class to target.
  const { class: classParam } = await searchParams;
  if (!classParam) {
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) {
      // No classes — show the empty state (full mode is still available without a class).
      return (
        <div className="p-5 flex flex-col gap-5">
          <PageHeader title="Import Roster" kicker="Add students" accent="brand" />
          <div className="p-6">{NO_CLASSES}</div>
        </div>
      );
    }
    redirect(`/import?class=${firstId}`);
  }

  // IDOR guard — the user must own (or have admin access to) the class.
  const guard = await guardClassAccess(classParam);
  if (guard) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <PageHeader title="Import Roster" kicker="Add students" accent="brand" />
        <div className="p-6">{CLASS_UNAVAILABLE}</div>
      </div>
    );
  }

  // All staff can run full; lean is available when a classId is present (which it always is here).
  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Import Roster" kicker="Add students" accent="brand" />
      <RosterImportTabs canFull={true} canLean={true} classId={classParam} />
    </div>
  );
}
