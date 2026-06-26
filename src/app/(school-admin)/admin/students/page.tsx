// src/app/(school-admin)/admin/students/page.tsx
// Student Attention rollup — academic-head only (school_admin + platform_admin).
// school_sysadmin is redirected at the URL level here as well as in the nav
// (defence in depth: nav hides the link; this page guards the route).
import { redirect } from 'next/navigation';
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentAttention } from '@/lib/school/loadStudentAttention';
import { PickASchool } from '../../_components/PickASchool';
import { AttentionRollup } from './_components/AttentionRollup';

export default async function StudentAttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await resolveAdminContext(sp);

  // URL re-guard: IT (school_sysadmin) may not reach the pedagogy layer
  if (!ctx.caps.canSeeStudentAttention) redirect('/admin/overview');

  if (!ctx.schoolId) return <PickASchool />;

  const admin = createAdminSupabaseClient();
  const data = await loadStudentAttention(admin, ctx.schoolId);

  return (
    <div className="space-y-6">
      <h1 className="text-fg font-display text-2xl font-bold">Student Attention</h1>
      <AttentionRollup data={data} />
    </div>
  );
}
