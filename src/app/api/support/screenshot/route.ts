// src/app/api/support/screenshot/route.ts
// POST — upload a screenshot to the private 'support-uploads' bucket.
//        Returns { path } — the storedPath the caller passes as screenshotPath to POST /api/support/tickets.
// GET  — auth-proxy for support screenshots.
//        platform_admin: any path; non-admin: only their OWN ticket's screenshot (ownership
//        check via support_tickets.screenshot_path = rawPath).
//
// Auth chain: createServerSupabaseClient() → auth.getUser() → 401 if no user.
// All DB/storage ops use createAdminSupabaseClient().
// Stored path format: support-uploads/${userId}/${uuid}.${ext}  (full path incl. bucket prefix
// stored in screenshot_path column so the proxy can validate the bucket prefix).
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const BUCKET = 'support-uploads';
const MAX_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

function contentTypeForPath(p: string): string {
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });

  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image files are accepted.' }, { status: 415 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Screenshot is too large (max 5 MB).' }, { status: 413 });
  }

  const ext = EXT[file.type] ?? 'img';
  const subPath = `${user.id}/${randomUUID()}.${ext}`;
  const storedPath = `${BUCKET}/${subPath}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const admin = createAdminSupabaseClient();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(subPath, buffer, { contentType: file.type, upsert: false });

  if (upErr) {
    console.error('[support/screenshot POST] upload failed', upErr);
    return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });
  }

  return NextResponse.json({ path: storedPath }, { status: 201 });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const rawPath = searchParams.get('path');
  if (!rawPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  // Path guards — checked BEFORE any DB/storage call
  if (rawPath.includes('..')) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  if (!rawPath.startsWith('support-uploads/')) {
    return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  }

  // Strip bucket prefix for the storage .download() call
  const subPath = rawPath.slice('support-uploads/'.length);

  const admin = createAdminSupabaseClient();

  // Resolve caller role
  const { data: userRow } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const role = (userRow as { role: string } | null)?.role;

  // Non-admin: ownership check via support_tickets.screenshot_path
  if (role !== 'platform_admin') {
    const { data: ticket } = await admin
      .from('support_tickets')
      .select('submitted_by')
      .eq('screenshot_path', rawPath)
      .maybeSingle();

    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if ((ticket as { submitted_by: string }).submitted_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { data, error } = await admin.storage.from(BUCKET).download(subPath);
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentTypeForPath(subPath),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
