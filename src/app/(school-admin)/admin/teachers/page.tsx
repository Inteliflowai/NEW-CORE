// src/app/(school-admin)/admin/teachers/page.tsx
// School-Admin Teachers page — lists all active teachers in the school with
// their class and student counts. Platform admins with no ?school= see PickASchool.
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadSchoolTeachers } from '@/lib/school/loadSchoolTeachers';
import { PickASchool } from '../../_components/PickASchool';
import { TeachersList } from './_components/TeachersList';

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const { schoolId } = await resolveAdminContext(sp);

  if (!schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const teachers = await loadSchoolTeachers(admin, schoolId);

  return (
    <div className="space-y-6">
      <h1 className="text-fg font-display text-2xl font-bold">Teachers</h1>
      <TeachersList teachers={teachers} />
    </div>
  );
}
