// src/app/(school-admin)/admin/reports/page.tsx
// School Reports page — operational summary: totals + per-class rollup + CSV export.
// Platform admins with no ?school= see PickASchool.
// NO per-student data ever reaches this page.
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadSchoolReport } from '@/lib/school/loadSchoolReport';
import { PickASchool } from '../../_components/PickASchool';
import { ReportView } from './_components/ReportView';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const { schoolId } = await resolveAdminContext(sp);

  if (!schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const report = await loadSchoolReport(admin, schoolId);

  return (
    <div className="space-y-6">
      <h1 className="text-fg font-display text-2xl font-bold">Reports</h1>
      <ReportView data={report} schoolId={schoolId} />
    </div>
  );
}
