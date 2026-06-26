// src/app/(school-admin)/admin/classes/page.tsx
// School-Admin Classes & Roster page — lists all active classes in the school with
// their enrollment counts and expandable rosters.
// Platform admins with no ?school= see PickASchool.
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadSchoolClasses } from '@/lib/school/loadSchoolClasses';
import { loadClassRoster } from '@/lib/school/loadClassRoster';
import { PickASchool } from '../../_components/PickASchool';
import { ClassesList, type ClassWithRoster } from './_components/ClassesList';

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const { schoolId } = await resolveAdminContext(sp);

  if (!schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const classes = await loadSchoolClasses(admin, schoolId);

  // Load all rosters upfront (one per class). Small schools: manageable.
  // Each call is IDOR-safe (verifies class.school_id === schoolId internally).
  const rosters = await Promise.all(
    classes.map(cls => loadClassRoster(admin, cls.id, schoolId)),
  );

  const items: ClassWithRoster[] = classes.map((cls, i) => ({
    cls,
    students: rosters[i]?.students ?? [],
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-fg font-display text-2xl font-bold">Classes &amp; Roster</h1>
      <ClassesList items={items} />
    </div>
  );
}
