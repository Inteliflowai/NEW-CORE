// src/app/api/admin/roster/template/route.ts
// GET /api/admin/roster/template — returns the downloadable 5-sheet .xlsx roster template.
// Gated to the school-admin tier (school_admin + platform_admin).

import { NextResponse } from 'next/server';
import { guardSchoolAdmin } from '@/lib/auth/guards';
import { buildRosterTemplate } from '@/lib/roster/template';

export const runtime = 'nodejs';

export async function GET() {
  const g = await guardSchoolAdmin();
  if ('error' in g) return g.error;

  return new NextResponse(new Uint8Array(buildRosterTemplate()), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="CORE_Roster_Template.xlsx"',
    },
  });
}
