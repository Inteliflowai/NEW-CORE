// src/app/api/teacher/lessons/parse/route.ts
// POST — parse an uploaded lesson (LIFT V1 route flow; engine logic in lib/engine).
// Auth: supabase.auth.getUser() for identity; role check (teacher/school_admin);
// guardClassAccess() for class-level IDOR protection; admin-client lesson query
// scoped to teacher_id=user.id for object-level ownership.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { extractUploadText } from '@/lib/engine/parseUpload';
import { parseLesson } from '@/lib/engine/lessonParse';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { guardClassAccess } from '@/lib/auth/guards';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Role check: only teacher-tier callers may trigger the LLM pipeline.
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const role: string | null = profile?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminSupabaseClient();
    const { lesson_id } = await req.json();
    if (!lesson_id) return NextResponse.json({ error: 'Missing lesson_id' }, { status: 400 });

    // Lesson must belong to this teacher — object-level guard via eq('teacher_id', user.id).
    const { data: lesson } = await admin
      .from('lessons')
      .select('id, file_url, file_type, file_name, teacher_id, parsed_content, class_id')
      .eq('id', lesson_id)
      .eq('teacher_id', user.id)
      .single();

    if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });

    // Class-level IDOR guard: teacher must currently have access to the target class.
    // This catches the reassignment case where lessons.teacher_id still points to the
    // old teacher but classes.teacher_id has moved on.
    if (lesson.class_id) {
      const classGuard = await guardClassAccess(lesson.class_id);
      if (classGuard) return classGuard;
    }

    // Already parsed? Return early with existing data.
    if (lesson.parsed_content) {
      return NextResponse.json({ lesson_id: lesson.id, parsed_content: lesson.parsed_content, already_parsed: true });
    }

    if (!lesson.file_url) return NextResponse.json({ error: 'Lesson has no file to parse' }, { status: 400 });

    // Download file from Supabase storage or via direct URL.
    // Use URL.pathname before matching to strip any query string from signed URLs
    // (e.g. ?token=...) — the old /\/lesson-uploads\/(.+)$/ regex captured the query
    // string, causing storage.download() to fail with a path-not-found error.
    let storagePath: string | null = null;
    try {
      const parsed = new URL(lesson.file_url);
      const pathMatch = parsed.pathname.match(/\/lesson-uploads\/(.+)$/);
      if (pathMatch) storagePath = decodeURIComponent(pathMatch[1]);
    } catch {
      // not a valid URL — fall through to direct fetch
    }

    let fileBuffer: Buffer;
    if (storagePath) {
      const { data: fileData, error: dlError } = await admin.storage
        .from('lesson-uploads')
        .download(storagePath);
      if (dlError || !fileData) {
        return NextResponse.json({ error: 'Failed to download lesson file' }, { status: 500 });
      }
      fileBuffer = Buffer.from(await fileData.arrayBuffer());
    } else {
      const res = await fetch(lesson.file_url);
      if (!res.ok) return NextResponse.json({ error: 'Failed to download lesson file' }, { status: 500 });
      fileBuffer = Buffer.from(await res.arrayBuffer());
    }

    const lessonText = await extractUploadText(fileBuffer, lesson.file_type || '', lesson.file_name || '');
    if (!lessonText.trim()) return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 });

    // Engine call #1 — throws LlmExhaustedError on terminal failure; catch below maps to 503.
    const parsed = await parseLesson(lessonText);

    // Persist — only real `lessons` columns (C3: id, class_id, teacher_id, title, file_name,
    // file_url, file_type, parsed_content, grade_level, subject, status, version, created_at).
    // Capture error: Supabase does NOT throw on write failure — a discarded error
    // would return HTTP 200 while nothing was persisted (silent data loss).
    const { error: updateError } = await admin.from('lessons').update({
      parsed_content: parsed,
      title: parsed.title || lesson.file_name,
      grade_level: parsed.grade_level,
      subject: parsed.subject,
      status: 'pending_review',
    }).eq('id', lesson.id);

    if (updateError) {
      return respondEngineError(new Error(`Failed to persist parsed lesson: ${updateError.message}`));
    }

    return NextResponse.json({ lesson_id: lesson.id, parsed_content: parsed });
  } catch (err) {
    console.error('[teacher/lessons/parse] error:', err);
    return respondEngineError(err);
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
