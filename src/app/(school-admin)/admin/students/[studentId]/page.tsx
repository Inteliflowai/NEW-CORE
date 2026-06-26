// src/app/(school-admin)/admin/students/[studentId]/page.tsx
// Admin-scoped read-only student drill-in (OPTION A).
// Lives inside (school-admin) so school_admin + platform_admin can access it
// without crossing into the (teacher) route group whose layout runs
// requireRole(['teacher']) — that would redirect them immediately.
// Capability-gated (school_sysadmin → /admin/overview).
// IDOR: student must belong to the resolved school.
// Band-level only — NEVER risk_score or divergence.
import { redirect } from 'next/navigation';
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';
import { Card } from '@/components/core/Card';

export default async function AdminStudentDrillIn({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ school?: string }>;
}) {
  const [{ studentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await resolveAdminContext(sp);

  // URL re-guard: IT cannot reach the pedagogy layer
  if (!ctx.caps.canSeeStudentAttention) redirect('/admin/overview');
  if (!ctx.schoolId) redirect('/admin/students');

  const admin = createAdminSupabaseClient();

  // IDOR: verify the student belongs to this school before reading anything
  const { data: student } = await admin
    .from('users')
    .select('id, full_name, grade_level, school_id')
    .eq('id', studentId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle();

  if (!student) redirect('/admin/students');

  // Per-skill band state: SELECT ONLY band-safe columns — NEVER risk_score or divergence
  const { data: snapshotRows } = await admin
    .from('student_model_snapshots')
    .select('mastery_band, skill_id, snapshot_date')
    .eq('student_id', studentId)
    .order('snapshot_date', { ascending: false })
    .limit(20);

  // Dedupe to latest per skill (ordered desc → first occurrence = latest)
  const latestBands = new Map<string, string>();
  for (const s of (snapshotRows ?? []) as Array<{
    mastery_band: string | null;
    skill_id: string | null;
    snapshot_date: string | null;
  }>) {
    if (s.skill_id && !latestBands.has(s.skill_id)) {
      latestBands.set(s.skill_id, s.mastery_band ?? '');
    }
  }

  const typedStudent = student as {
    id: string;
    full_name: string | null;
    grade_level: string | null;
    school_id: string;
  };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <a
          href="/admin/students"
          className="text-fg-muted text-sm hover:text-fg transition-colors"
        >
          ← Back to Student Attention
        </a>
      </div>
      <Card className="p-6">
        <h1 className="text-fg text-xl font-semibold mb-1">
          {typedStudent.full_name ?? 'Student'}
        </h1>
        {typedStudent.grade_level && (
          <p className="text-fg-muted text-sm mb-4">Grade {typedStudent.grade_level}</p>
        )}
        {latestBands.size === 0 ? (
          <p className="text-fg-muted text-sm">No skill data yet.</p>
        ) : (
          <ul className="space-y-2" role="list">
            {Array.from(latestBands.entries()).map(([skillId, band]) => (
              <li
                key={skillId}
                className="flex items-center justify-between py-1 border-b border-fg-muted/15 last:border-0"
              >
                <span className="text-fg text-sm">Skill {skillId.slice(0, 8)}</span>
                <span className="text-fg-muted text-sm">{masteryDisplayLabel(band)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
