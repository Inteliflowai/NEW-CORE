// src/app/api/support/tickets/[id]/route.ts
// PATCH — platform_admin only: update ticket status and/or assigned_to.
//
// Auth: guardPlatformAdmin() → 401 if no session, 403 if not platform_admin.
// All DB ops via createAdminSupabaseClient() (RLS bypass — guard is the wall).
// resolved_at is managed automatically:
//   status='resolved'     → resolved_at = now()
//   status!=resolved      → resolved_at = null
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardPlatformAdmin } from '@/lib/auth/guards';

const VALID_STATUSES = new Set(['open', 'in_progress', 'resolved']);

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  // Platform-admin gate — returns 401 or 403 response on failure, null on pass
  const guard = await guardPlatformAdmin();
  if (guard) return guard;

  const { id } = await params;

  let body: { status?: unknown; assigned_to?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    patch.status = body.status;
    // Manage resolved_at automatically based on status transition
    if (body.status === 'resolved') {
      patch.resolved_at = new Date().toISOString();
    } else {
      patch.resolved_at = null;
    }
  }

  if ('assigned_to' in body) {
    patch.assigned_to = body.assigned_to ?? null;
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('support_tickets')
    .update(patch)
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = "0 rows" from .single() — the ticket id doesn't exist
    const code = (error as { code?: string }).code;
    if (code === 'PGRST116') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[support/tickets/[id] PATCH] update failed', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
