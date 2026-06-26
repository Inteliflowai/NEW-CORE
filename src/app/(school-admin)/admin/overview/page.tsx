// src/app/(school-admin)/admin/overview/page.tsx
// School Overview — the landing page for the school-admin surface.
// Platform admins with no ?school= see PickASchool; everyone else sees the overview.
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadSchoolOverview } from '@/lib/school/loadSchoolOverview';
import { PickASchool } from '../../_components/PickASchool';
import { OverviewCards } from './_components/OverviewCards';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const { schoolId } = await resolveAdminContext(sp);

  if (!schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const data = await loadSchoolOverview(admin, schoolId);

  return <OverviewCards data={data} />;
}
