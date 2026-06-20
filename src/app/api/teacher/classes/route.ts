import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';

// ── Label helper (exported for unit tests) ────────────────────────────────────

export function formatClassLabel(c: { name: string; period?: string | null }): string {
  return c.period ? `${c.name} — Period ${c.period}` : c.name;
}

type ClassRow = { id: string; name: string; period: string | null; subject: string | null };

/** Count enrollment rows per class_id (caller pre-filters to is_active = true). */
export function tallyActiveCounts(rows: { class_id: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.class_id] = (out[r.class_id] ?? 0) + 1;
  return out;
}

/** Merge class rows with active-student counts into the API payload shape. */
export function buildClassPayload(classes: ClassRow[], counts: Record<string, number>) {
  return classes.map((c) => ({
    class_id: c.id,
    label: formatClassLabel({ name: c.name, period: c.period }),
    subject: c.subject ?? null,
    student_count: counts[c.id] ?? 0,
  }));
}

// ── GET /api/teacher/classes ──────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Role + school_id gate (single query) ──────────────────────────────────
  const { data: profile } = await supabase
    .from('users')
    .select('role, school_id')
    .eq('id', user.id)
    .single();
  const role = profile?.role ?? null;
  if (!role || !new Set(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 3. Admin client — synchronous ────────────────────────────────────────────
  const admin = createAdminSupabaseClient();

  // ── 4. Per-role scoping (explicit branches, no cross-tenant leak) ─────────────
  let query = admin.from('classes').select('id, name, period, subject');

  if (role === 'teacher') {
    query = query.eq('teacher_id', user.id);
  } else if (role === 'school_admin' || role === 'school_sysadmin') {
    if (!profile?.school_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    query = query.eq('school_id', profile.school_id);
  }
  // platform_admin: no filter — sees all classes

  const { data: classes, error: dbError } = await query;
  if (dbError) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  // ── 5. Live active-student count per class ───────────────────────────────────
  const classIds = (classes ?? []).map((c: { id: string }) => c.id);
  let counts: Record<string, number> = {};
  if (classIds.length > 0) {
    const { data: enr, error: enrErr } = await admin
      .from('enrollments')
      .select('class_id')
      .in('class_id', classIds)
      .eq('is_active', true);
    if (enrErr) {
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
    counts = tallyActiveCounts((enr ?? []) as { class_id: string }[]);
  }

  const result = buildClassPayload((classes ?? []) as ClassRow[], counts);
  return NextResponse.json({ classes: result });
}
