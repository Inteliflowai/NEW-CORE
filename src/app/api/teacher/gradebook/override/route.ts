// src/app/api/teacher/gradebook/override/route.ts
// POST — teacher/admin grade override + reteach toggle. Auth chain re-checked server-side.
// Never mutates score_pct or status (override-wins is teacher_score ?? score_pct). Spec §8.2.
import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import { logAudit } from '@/lib/audit/logAudit';

type Body = { attempt_id?: string; teacher_score?: number | null; teacher_notes?: string | null; allow_redo?: boolean };
const MAX_NOTES = 2000;

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !body.attempt_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const hasScore = 'teacher_score' in body;
    const hasNotes = 'teacher_notes' in body;
    const hasRedo = 'allow_redo' in body;
    if (!hasScore && !hasNotes && !hasRedo) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    if (hasScore && body.teacher_score != null && (!Number.isFinite(body.teacher_score) || body.teacher_score < 0 || body.teacher_score > 100))
      return NextResponse.json({ error: 'invalid_score' }, { status: 400 });
    if (hasNotes && body.teacher_notes != null && (typeof body.teacher_notes !== 'string' || body.teacher_notes.length > MAX_NOTES))
      return NextResponse.json({ error: 'invalid_notes' }, { status: 400 });
    if (hasRedo && typeof body.allow_redo !== 'boolean')
      return NextResponse.json({ error: 'invalid_redo' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role;
    if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: attemptRow } = await admin.from('homework_attempts')
      .select('id, assignment_id, student_id, status, score_pct, teacher_score').eq('id', body.attempt_id).maybeSingle();
    const attempt = attemptRow as { id: string; assignment_id: string; student_id: string; status: string; score_pct: number | null; teacher_score: number | null } | null;
    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    const { data: asgRow } = await admin.from('assignments').select('class_id').eq('id', attempt.assignment_id).maybeSingle();
    const asg = asgRow as { class_id: string } | null;
    if (!asg) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

    const guard = await guardClassAccess(asg.class_id);
    if (guard) return guard;

    const { data: clsRow } = await admin.from('classes').select('school_id').eq('id', asg.class_id).maybeSingle();
    const schoolId = (clsRow as { school_id?: string | null } | null)?.school_id ?? null;

    // 409 only when a GRADE override targets a non-graded attempt.
    if (hasScore && body.teacher_score != null && attempt.status !== 'graded')
      return NextResponse.json({ error: 'not_graded' }, { status: 409 });

    const patch: Record<string, unknown> = {};
    if (hasScore) patch.teacher_score = body.teacher_score;
    if (hasNotes) patch.teacher_notes = body.teacher_notes;
    if (hasRedo) patch.allow_redo = body.allow_redo;
    // Fail loud on a write error — never return 200 on a silent grade-write failure (I1).
    const { error: writeErr } = await admin.from('homework_attempts').update(patch).eq('id', attempt.id);
    if (writeErr) return NextResponse.json({ error: 'Server error' }, { status: 500 });

    try {
      await logAudit(admin, {
        actorId: user.id,
        schoolId,
        action: 'grade.override',
        resourceType: 'homework_attempt',
        resourceId: attempt.id,
        metadata: {
          before: { teacher_score: attempt.teacher_score, score_pct: attempt.score_pct },
          after: { teacher_score: hasScore ? body.teacher_score : attempt.teacher_score, allow_redo: hasRedo ? body.allow_redo : undefined, notes_changed: hasNotes },
        },
      });
    } catch (err) { console.warn('[gradebook-override] audit failed (non-fatal):', err); }

    after(async () => {
      try { await recomputeSkillStatesForStudent(admin, { studentId: attempt.student_id, schoolId: null }); }
      catch (err) { console.warn('[gradebook-override] recompute failed (non-fatal):', err); }
    });

    const newScore = hasScore ? body.teacher_score : attempt.teacher_score;
    const displayed_grade = (typeof newScore === 'number') ? newScore : (attempt.score_pct ?? null);
    return NextResponse.json({ ok: true, attempt_id: attempt.id, displayed_grade });
  } catch (err) {
    console.error('[gradebook-override] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
