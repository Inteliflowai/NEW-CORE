// src/app/api/teacher/lessons/parse/route.ts
// POST — parse an uploaded lesson (LIFT V1 route flow; engine logic in lib/engine).
// Auth: supabase.auth.getUser() for identity; admin-client lesson query scoped to
// teacher_id=user.id acts as the object-level access guard (guardClassAccess is
// available for class-level checks but lesson ownership suffices here).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { extractUploadText } from '@/lib/engine/parseUpload';
import { parseLesson } from '@/lib/engine/lessonParse';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Already parsed? Return early with existing data.
    if (lesson.parsed_content) {
      return NextResponse.json({ lesson_id: lesson.id, parsed_content: lesson.parsed_content, already_parsed: true });
    }

    if (!lesson.file_url) return NextResponse.json({ error: 'Lesson has no file to parse' }, { status: 400 });

    // Download file from Supabase storage or via direct URL.
    const m = lesson.file_url.match(/\/lesson-uploads\/(.+)$/);
    let fileBuffer: Buffer;
    if (m) {
      const { data: fileData, error: dlError } = await admin.storage
        .from('lesson-uploads')
        .download(decodeURIComponent(m[1]));
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
    await admin.from('lessons').update({
      parsed_content: parsed,
      title: parsed.title || lesson.file_name,
      grade_level: parsed.grade_level,
      subject: parsed.subject,
      status: 'pending_review',
    }).eq('id', lesson.id);

    return NextResponse.json({ lesson_id: lesson.id, parsed_content: parsed });
  } catch (err) {
    console.error('[teacher/lessons/parse] error:', err);
    return respondEngineError(err);
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
