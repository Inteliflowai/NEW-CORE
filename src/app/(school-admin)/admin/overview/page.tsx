// src/app/(school-admin)/admin/overview/page.tsx
// School Overview — the landing page for the school-admin surface.
// Platform admins with no ?school= see PickASchool; everyone else sees the overview.
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadSchoolOverview } from '@/lib/school/loadSchoolOverview';
import { loadStudentAttention } from '@/lib/school/loadStudentAttention';
import { PickASchool } from '../../_components/PickASchool';
import { OverviewCards } from './_components/OverviewCards';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const { schoolId, caps } = await resolveAdminContext(sp);

  if (!schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const [data, attentionData] = await Promise.all([
    loadSchoolOverview(admin, schoolId),
    caps.canSeeStudentAttention ? loadStudentAttention(admin, schoolId) : Promise.resolve(null),
  ]);

  // Count totals for the attention line (school_admin only; quiet when zero)
  const studentsNeedingAttention = attentionData
    ? attentionData.grades.flatMap(g => g.classes.flatMap(c => c.students)).length
    : null;
  const classesNeedingAttention = attentionData
    ? attentionData.grades.flatMap(g => g.classes).filter(c => c.students.length > 0).length
    : null;

  return (
    <OverviewCards
      data={data}
      studentsNeedingAttention={studentsNeedingAttention}
      classesNeedingAttention={classesNeedingAttention}
    />
  );
}
