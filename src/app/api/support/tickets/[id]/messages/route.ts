// src/app/api/support/tickets/[id]/messages/route.ts
// POST — submitter or platform_admin: add a message to a ticket.
//        App-layer is_internal enforcement: only platform_admin may set is_internal=true.
// GET  — submitter (non-internal only) or platform_admin (all messages).
//        Belt-and-suspenders: non-admin gets .eq('is_internal', false) on top of RLS.
//
// Auth chain: createServerSupabaseClient() → auth.getUser() → 401.
// All DB ops via createAdminSupabaseClient() (RLS bypass — guard is the wall).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// ─── Shared: resolve ticket + caller ─────────────────────────────────────────

type ResolvedContext =
  | { ok: false; response: NextResponse }
  | { ok: true; ticketData: { submitted_by: string }; userId: string; role: string | null };

async function resolveTicketAndCaller(ticketId: string): Promise<ResolvedContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const admin = createAdminSupabaseClient();

  // Verify the ticket exists and get its submitter
  const { data: ticket } = await admin
    .from('support_tickets')
    .select('submitted_by')
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  // Get caller role from DB (never from the JWT)
  const { data: userRow } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = (userRow as { role: string } | null)?.role ?? null;

  // Gate: submitter or platform_admin
  const submittedBy = (ticket as { submitted_by: string }).submitted_by;
  if (submittedBy !== user.id && role !== 'platform_admin') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, ticketData: { submitted_by: submittedBy }, userId: user.id, role };
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: ticketId } = await params;
  const ctx = await resolveTicketAndCaller(ticketId);
  if (!ctx.ok) return ctx.response;

  const { userId, role } = ctx;

  let body: { message?: unknown; is_internal?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (typeof body.message !== 'string' || body.message.trim() === '') {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // App-layer enforcement: non-platform-admin is ALWAYS false regardless of body
  const is_internal = role === 'platform_admin' ? body.is_internal === true : false;

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('support_ticket_messages').insert({
    ticket_id: ticketId,
    sender_id: userId,
    message: body.message.trim(),
    is_internal,
  });

  if (error) {
    console.error('[support/tickets/[id]/messages POST] insert failed', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: ticketId } = await params;
  const ctx = await resolveTicketAndCaller(ticketId);
  if (!ctx.ok) return ctx.response;

  const { role } = ctx;

  const admin = createAdminSupabaseClient();

  // Build query: always filter by ticket_id, order ASC
  let query = admin
    .from('support_ticket_messages')
    .select('id, sender_id, message, is_internal, created_at')
    .eq('ticket_id', ticketId);

  // Belt-and-suspenders: non-admin never sees internal messages
  if (role !== 'platform_admin') {
    query = query.eq('is_internal', false);
  }

  const { data: messages, error } = await query.order('created_at', { ascending: true });

  if (error) {
    console.error('[support/tickets/[id]/messages GET] query failed', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}
