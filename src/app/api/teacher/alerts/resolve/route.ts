// POST /api/teacher/alerts/resolve — manually resolve an alert. Auth chain + class IDOR guard.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';

const STAFF = new Set<string>(STAFF_ROLES);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { alert_id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const alertId = typeof body.alert_id === 'string' ? body.alert_id : null;
  if (!alertId) return NextResponse.json({ error: 'alert_id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !STAFF.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const { data: alert } = await admin.from('alerts').select('id, class_id, status').eq('id', alertId).maybeSingle();
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const guard = await guardClassAccess((alert as { class_id: string }).class_id);
  if (guard) return guard;

  if ((alert as { status: string }).status === 'resolved') return NextResponse.json({ ok: true });

  const { error } = await admin.from('alerts')
    .update({ status: 'resolved', resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', alertId).eq('status', 'open');
  if (error) { console.error('alerts/resolve write failed', error); return NextResponse.json({ error: 'Write failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
