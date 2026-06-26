// POST /api/teacher/lessons/import-drive
// Import a Google Drive file (Docs/Slides/PDF) as a lesson using the teacher's
// already-connected OAuth token (drive.readonly granted at Seg-1 connect).
// Auth chain mirrors publish/route.ts exactly. No DB migration needed.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';
import { extractTextFromGoogleDriveFile } from '@/lib/google/drive';
import { DriveFileNotFoundError, DriveAccessDeniedError, DriveUnsupportedTypeError } from '@/lib/google/errors';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';
import { parseLesson } from '@/lib/engine/lessonParse';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth chain ─────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (!STAFF_ROLES.includes((profile as { role?: string } | null)?.role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { file_id?: string; class_id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const fileId = (body?.file_id ?? '').trim();
  const classId = (body?.class_id ?? '').trim();
  if (!fileId || !classId) {
    return NextResponse.json({ error: 'Missing file_id or class_id' }, { status: 400 });
  }

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  // ── Drive extraction + lesson insert (token fetch INSIDE try — mirrors publish/route.ts M5) ──
  const admin = createAdminSupabaseClient();

  try {
    const accessToken = await getValidAccessTokenForTeacher(admin, user.id);
    const text = await extractTextFromGoogleDriveFile(fileId, accessToken);

    if (!text.trim()) {
      return NextResponse.json(
        { error: 'No readable text in that Drive file.', code: 'drive_empty' },
        { status: 400 },
      );
    }

    const parsed = await parseLesson(text);

    const { data: lesson, error: insErr } = await admin
      .from('lessons')
      .insert({
        class_id: classId,
        teacher_id: user.id,
        title: parsed.title || 'Imported from Google Drive',
        parsed_content: parsed,
        subject: parsed.subject,
        grade_level: parsed.grade_level,
        status: 'pending_review',
        source: 'google_drive',
      })
      .select('id')
      .single();

    if (insErr || !lesson) {
      console.error('[teacher/lessons/import-drive] persist error:', insErr ?? 'no row returned');
      return respondEngineError(new Error('Failed to persist lesson'));
    }

    return NextResponse.json({
      lesson_id: (lesson as { id: string }).id,
      parsed_content: parsed,
    });
  } catch (err) {
    // Drive-specific typed errors → structured 4xx responses
    if (err instanceof DriveFileNotFoundError) {
      return NextResponse.json(
        { error: "We couldn't find that file in Google Drive.", code: 'drive_not_found' },
        { status: 404 },
      );
    }
    if (err instanceof DriveAccessDeniedError) {
      return NextResponse.json(
        { error: "This file isn't shared with your Google account.", code: 'drive_access_denied' },
        { status: 400 },
      );
    }
    if (err instanceof DriveUnsupportedTypeError) {
      return NextResponse.json(
        {
          error: "This file type can't be imported as a lesson. Try exporting it as a PDF first.",
          code: 'drive_unsupported_type',
        },
        { status: 400 },
      );
    }
    // Google auth errors → connected:false / needsReconnect (HTTP 200, same as other GC routes)
    if (err instanceof GoogleNotConnectedError || err instanceof GoogleScopeError) {
      return gcErrorResponse(err);
    }
    // LlmExhaustedError → 503; all other errors → 500
    console.error('[teacher/lessons/import-drive] error:', err instanceof Error ? err.message : 'unknown');
    return respondEngineError(err);
  }
}
