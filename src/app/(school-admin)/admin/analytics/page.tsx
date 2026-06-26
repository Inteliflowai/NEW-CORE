// src/app/(school-admin)/admin/analytics/page.tsx
// School Analytics page — aggregate weekly activity, per-class completion,
// and adoption counts. Platform admins with no ?school= see PickASchool.
// AGGREGATE ONLY — no per-student rows ever reach the UI.
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadSchoolAnalytics } from '@/lib/school/loadSchoolAnalytics';
import { PickASchool } from '../../_components/PickASchool';
import { AnalyticsView } from './_components/AnalyticsView';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const { schoolId } = await resolveAdminContext(sp);

  if (!schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const data = await loadSchoolAnalytics(admin, schoolId);

  return (
    <div className="space-y-6">
      <h1 className="text-fg font-display text-2xl font-bold">Analytics</h1>
      <AnalyticsView data={data} />
    </div>
  );
}
