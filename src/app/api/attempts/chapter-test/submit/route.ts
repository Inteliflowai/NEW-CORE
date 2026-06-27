// src/app/api/attempts/chapter-test/submit/route.ts
// POST — final submit for a chapter test attempt; triggers async grading via after().
//
// Auth chain:
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   admin.from('users').select('role, school_id')  → 403 if not student
//   admin client (service-role) — bypasses RLS; student_id check IS the IDOR backstop
//
// Algorithm:
//   1. Auth (student only)
//   2. Parse body: { attemptId, forfeit_reason? }
//   3. Load attempt → 404 if missing, 403 if wrong student, 409 if not in_progress
//   4. Update attempt: status='submitted', submitted_at=now(), forfeit_reason
//   5. logAudit: chapter_test.submit (best-effort — logAudit is internally fail-soft)
//   6. after(): gradeChapterAttempt(attemptId, admin) — async, non-fatal
//   7. Return { ok: true, attempt_id }

import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeChapterAttempt } from '@/lib/chapters/gradeChapterTest';
import { logAudit } from '@/lib/audit/logAudit';

type AttemptRow = {
  id: string;
  student_id: string;
  status: string;
  chapter_test_id: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabaseClient();

  // ── 2. Role check: student only ────────────────────────────────────────────
  const { data: userRow } = await admin
    .from('users')
    .select('role, school_id')
    .eq('id', user.id)
    .maybeSingle();
  if ((userRow as { role?: string } | null)?.role !== 'student') {
    return NextResponse.json({ error: 'Forbidden: student access only' }, { status: 403 });
  }
  const schoolId = (userRow as { school_id?: string | null } | null)?.school_id ?? null;

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  let body: {
    attemptId?: string;
    forfeit_reason?: 'time_up' | 'closure' | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { attemptId, forfeit_reason } = body;
  if (!attemptId) return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 });

  // ── 4. Load attempt ────────────────────────────────────────────────────────
  const { data: attemptData } = await admin
    .from('chapter_test_attempts')
    .select('id, student_id, status, chapter_test_id')
    .eq('id', attemptId)
    .single();
  const attempt = attemptData as AttemptRow | null;

  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

  // ── 5. IDOR guard ──────────────────────────────────────────────────────────
  if (attempt.student_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 6. Status guard (idempotent-safe) ─────────────────────────────────────
  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 });
  }

  // ── 7. Mark submitted ──────────────────────────────────────────────────────
  await admin
    .from('chapter_test_attempts')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      forfeit_reason: forfeit_reason ?? null,
    })
    .eq('id', attemptId)
    .eq('student_id', user.id);

  // ── 8. Audit log (best-effort — logAudit is internally fail-soft) ─────────
  await logAudit(admin, {
    actorId: user.id,
    schoolId,
    action: 'chapter_test.submit',
    resourceType: 'chapter_test_attempt',
    resourceId: attemptId,
    metadata: {
      chapter_test_id: attempt.chapter_test_id,
      forfeit_reason: forfeit_reason ?? null,
    },
  });

  // ── 9. Trigger async grading (non-fatal) ──────────────────────────────────
  after(async () => {
    try {
      await gradeChapterAttempt(attemptId, admin);
    } catch (err) {
      console.warn('[chapter-test/submit] gradeChapterAttempt failed (non-fatal):', err);
    }
  });

  // ── 10. Return ok ──────────────────────────────────────────────────────────
  return NextResponse.json({ ok: true, attempt_id: attemptId });
}
