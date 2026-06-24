// src/app/(teacher)/import/page.tsx
// Server Component — async. Accessible to both teachers (lean) and school admins / platform_admin
// (full). The (teacher) layout already gates requireRole(['teacher']) for the teacher rail; admins
// reach here through the same layout guard but with a staff role — so we use requireRole(STAFF_ROLES)
// to cover both. Then we compute `mode` based on whether the caller is a school-admin-tier role.
//
// Teacher (lean): resolve classId exactly like /upload (searchParams.class →
//   firstClassIdForTeacher → redirect → guardClassAccess). No classId → NO_CLASSES.
// Admin (full): classId not needed; skip the class-resolution step entirely.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { EmptyState } from '@/components/core/EmptyState';
import { SCHOOL_ADMIN_ROLES, STAFF_ROLES } from '@/lib/auth/roles';
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
  const { userId, role } = await requireRole(STAFF_ROLES);

  // Determine mode: school_admin / school_sysadmin / platform_admin → full; teacher → lean.
  const mode = (SCHOOL_ADMIN_ROLES as readonly string[]).includes(role) ? 'full' : 'lean';

  if (mode === 'lean') {
    // Teacher path: resolve classId the same way /upload does.
    const { class: classId } = await searchParams;
    if (!classId) {
      const firstId = await firstClassIdForTeacher(userId);
      if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
      redirect(`/import?class=${firstId}`);
    }

    // IDOR guard — teacher must own the class.
    const guard = await guardClassAccess(classId);
    if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

    return (
      <div className="p-5 flex flex-col gap-5">
        <PageHeader title="Import Roster" kicker="Add students" accent="brand" />
        <RosterImportTabs mode="lean" classId={classId} />
      </div>
    );
  }

  // Admin (full) path: classId not needed.
  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Import Roster" kicker="Add students" accent="brand" />
      <RosterImportTabs mode="full" classId={null} />
    </div>
  );
}
