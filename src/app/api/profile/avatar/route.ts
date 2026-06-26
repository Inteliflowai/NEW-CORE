// src/app/api/profile/avatar/route.ts
// POST — upload the caller's OWN avatar. GET — auth'd proxy serving the caller's OWN avatar.
// Private 'avatars' bucket; users.avatar_url stores a proxy link to GET (never public). Mirrors the
// student-drawings image-proxy pattern. Own-avatar only in v1 (cross-user display is a later add).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const BUCKET = 'avatars';
const MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function contentTypeForPath(path: string): string {
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is too large (max 4 MB).' }, { status: 413 });

  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const admin = createAdminSupabaseClient();
  const { data, error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr || !data) return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });

  const avatarUrl = `/api/profile/avatar?path=${encodeURIComponent(path)}`;
  const { error: updErr } = await admin.from('users').update({ avatar_url: avatarUrl }).eq('id', user.id);
  if (updErr) return NextResponse.json({ error: 'Could not save your photo — try again.' }, { status: 500 });
  return NextResponse.json({ avatar_url: avatarUrl });
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const path = new URL(req.url).searchParams.get('path');
  if (!path || path.includes('..')) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  const segs = path.split('/');
  if (segs.length < 2 || !segs[0]) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  if (user.id !== segs[0]) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentTypeForPath(path),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
