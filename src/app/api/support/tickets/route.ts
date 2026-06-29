// src/app/api/support/tickets/route.ts
// POST — any authenticated user submits a support ticket.
// GET  — platform_admin: all tickets (paginated + optional status filter);
//        authenticated non-admin with ?mine=1: own tickets only;
//        otherwise 403.
//
// Auth chain: createServerSupabaseClient() → auth.getUser() → 401 if no user.
// All DB writes/reads use createAdminSupabaseClient() (RLS bypass).
// submitted_by_role + school_id are ALWAYS read from the DB — never the JWT.
// screenshotPath is validated server-side (bucket prefix check) — never trust the client.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

const VALID_CATEGORIES = new Set(['general', 'bug', 'feature', 'account', 'data', 'other']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'resolved']);
const PAGE_SIZE = 20;

type UserRow = { role: string; school_id: string | null };

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    subject?: unknown;
    description?: unknown;
    category?: unknown;
    priority?: unknown;
    screenshotPath?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  // Required fields
  if (typeof body.subject !== 'string' || body.subject.trim() === '') {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 });
  }
  if (typeof body.description !== 'string' || body.description.trim() === '') {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  // Optional: category — coerce to 'general' if absent; reject if present and invalid
  let category = 'general';
  if (body.category != null) {
    if (typeof body.category !== 'string' || !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    category = body.category;
  }

  // Optional: priority — coerce to 'normal' if absent; reject if present and invalid
  let priority = 'normal';
  if (body.priority != null) {
    if (typeof body.priority !== 'string' || !VALID_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    priority = body.priority;
  }

  // Optional: screenshotPath — must be under the caller's own subfolder to prevent cross-user exfil.
  // A malicious client could pass another user's path (same bucket) and hijack their screenshot.
  let screenshotPath: string | null = null;
  if (body.screenshotPath != null) {
    const expectedPrefix = `support-uploads/${user.id}/`;
    if (
      typeof body.screenshotPath !== 'string' ||
      !body.screenshotPath.startsWith(expectedPrefix)
    ) {
      return NextResponse.json({ error: 'Invalid screenshotPath' }, { status: 400 });
    }
    screenshotPath = body.screenshotPath;
  }

  const admin = createAdminSupabaseClient();

  // Snapshot role + school_id from the DB — never derive from the JWT
  const { data: userRow } = await admin
    .from('users')
    .select('role, school_id')
    .eq('id', user.id)
    .single();
  const submitted_by_role = (userRow as UserRow | null)?.role ?? 'unknown';
  const school_id = (userRow as UserRow | null)?.school_id ?? null;

  const { data: ticket, error } = await admin
    .from('support_tickets')
    .insert({
      submitted_by: user.id,
      submitted_by_role,
      school_id,
      subject: body.subject.trim(),
      description: body.description.trim(),
      category,
      priority,
      screenshot_path: screenshotPath,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[support/tickets POST] insert failed', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json({ ticketId: (ticket as { id: string }).id }, { status: 201 });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: userRow } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = (userRow as { role: string } | null)?.role;

  const { searchParams } = new URL(req.url);

  // ── platform_admin: all tickets, paginated, optional status filter ────────
  if (role === 'platform_admin') {
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0);
    const statusFilter = searchParams.get('status');

    let query = admin
      .from('support_tickets')
      .select(
        'id, subject, category, priority, status, submitted_by_role, school_id, created_at, assigned_to, description, screenshot_path',
      )
      .order('created_at', { ascending: false });

    if (statusFilter && VALID_STATUSES.has(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const { data: tickets, error } = await query.range(
      page * PAGE_SIZE,
      (page + 1) * PAGE_SIZE - 1,
    );

    if (error) {
      console.error('[support/tickets GET] admin query failed', error);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    const list = (tickets ?? []) as unknown[];
    return NextResponse.json({ tickets: list, page, hasMore: list.length === PAGE_SIZE });
  }

  // ── any authenticated user with ?mine=1: own tickets only ─────────────────
  // NOTE: priority is deliberately excluded from this select — it is only visible
  // to platform_admin, not to the submitter.
  if (searchParams.get('mine') === '1') {
    const { data: tickets, error } = await admin
      .from('support_tickets')
      .select('id, subject, category, status, created_at')
      .eq('submitted_by', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[support/tickets GET] mine query failed', error);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    return NextResponse.json({ tickets: tickets ?? [] });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
