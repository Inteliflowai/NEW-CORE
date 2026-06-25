// src/app/api/admin/audit/route.ts
// GET — platform_admin reads the audit trail. No UI this epic; this answers "who did X, when?".
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardPlatformAdmin } from '@/lib/auth/guards';

const MAX = 200;

export async function GET(req: Request) {
  const guard = await guardPlatformAdmin();
  if (guard) return guard;
  const url = new URL(req.url);
  const schoolId = url.searchParams.get('school_id');
  const action = url.searchParams.get('action');
  const resourceType = url.searchParams.get('resource_type');
  const admin = createAdminSupabaseClient();
  let q = admin.from('audit_logs')
    .select('id, actor_id, school_id, action, resource_type, resource_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX);
  if (schoolId) q = q.eq('school_id', schoolId);
  if (action) q = q.eq('action', action);
  if (resourceType) q = q.eq('resource_type', resourceType);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
