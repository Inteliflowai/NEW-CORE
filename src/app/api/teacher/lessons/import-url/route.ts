// POST — import a lesson from a public / link-shared URL (incl. published Google Docs).
// Auth chain mirrors lessons/parse. Fetch+extract (SSRF-guarded) → existing parseLesson → insert
// source='url', pending_review. The client then runs the fuzzy-dup gate + /quizzes/generate.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { extractTextFromUrl, UrlFetchError } from '@/lib/engine/parseUrl';
import { parseLesson } from '@/lib/engine/lessonParse';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();
    const role: string | null = (profile as { role?: string } | null)?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = (await req.json().catch(() => null)) as { url?: string; class_id?: string } | null;
    const url = body?.url?.trim();
    const classId = body?.class_id;
    if (!url || !classId) return NextResponse.json({ error: 'Missing url or class_id' }, { status: 400 });

    const guard = await guardClassAccess(classId);
    if (guard) return guard;

    let text: string;
    try {
      text = await extractTextFromUrl(url);
    } catch (err) {
      if (err instanceof UrlFetchError) {
        return NextResponse.json({ error: err.message, code: 'url_fetch' }, { status: 400 });
      }
      throw err;
    }
    if (!text.trim()) return NextResponse.json({ error: 'No readable text at that link.', code: 'url_fetch' }, { status: 400 });

    // parseLesson throws LlmExhaustedError on terminal failure → outer catch → respondEngineError (503).
    const parsed = await parseLesson(text);

    let host = url;
    try { host = new URL(url).hostname; } catch { /* keep raw */ }

    const { data: lesson, error: insErr } = await admin.from('lessons').insert({
      class_id: classId,
      teacher_id: user.id,
      title: parsed.title || `Imported from ${host}`,
      file_url: url,
      parsed_content: parsed,
      subject: parsed.subject,
      grade_level: parsed.grade_level,
      status: 'pending_review',
      source: 'url',
    }).select('id').single();

    if (insErr || !lesson) {
      return respondEngineError(new Error(`Failed to persist imported lesson: ${insErr?.message ?? 'no row'}`));
    }
    return NextResponse.json({ lesson_id: (lesson as { id: string }).id, parsed_content: parsed });
  } catch (err) {
    console.error('[teacher/lessons/import-url] error:', err);
    return respondEngineError(err);
  }
}
