// src/app/api/admin/roster/template/route.ts
// GET /api/admin/roster/template — returns the downloadable 5-sheet .xlsx roster template.
// Open to all STAFF_ROLES (teacher / school_admin / school_sysadmin / platform_admin).
// Marvin 2026-06-24: widened from school-admin tier so teachers can download the template.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { buildRosterTemplate } from '@/lib/roster/template';

export const runtime = 'nodejs';

export async function GET() {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = profile?.role ?? null;
  if (!role || !(STAFF_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return new NextResponse(new Uint8Array(buildRosterTemplate()), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="CORE_Roster_Template.xlsx"',
    },
  });
}
