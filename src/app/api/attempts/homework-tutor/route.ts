// src/app/api/attempts/homework-tutor/route.ts
// POST /api/attempts/homework-tutor — Teli, the Socratic tutor (Assignment Player Segment 3).
//
// The server is AUTHORITATIVE for the hint rung + counts. The client never decides a rung.
// Defense in depth lives in generateGuardedHint (the reply is always a checked, safe string;
// Teli NEVER reveals the answer). This route adds the persistence + the race-robust ladder:
//   • count-after-insert: the student turn is written BEFORE the help count is read, so two
//     concurrent pulls can never share a rung.
//   • atomic counter bump via the bump_tutor_session RPC (no read-modify-write lost update).
//   • one active tutor_session per attempt (a partial-unique index backs the find-or-create;
//     a 23505 on the create race re-selects the existing row).
//
// Auth chain: createServerSupabaseClient → auth.getUser (401) → admin client →
// object-ownership guard (.eq id .eq student_id, 404 existence-hiding). RLS is NOT the IDOR
// backstop. Never 500s on a generation failure — generateGuardedHint always returns safely.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { generateGuardedHint } from '@/lib/teli/generateHint';
import { rungForHelpCount, hintsRemaining, type HintRung } from '@/lib/teli/ladder';
import { normalizeContent, type AssignmentContent } from '@/lib/assignments/loadAssignmentForPlay';

type TutorBody = { attempt_id?: string; task_step?: number; student_message?: string; is_help_request?: boolean };

export async function POST(req: Request) {
  try {
    // 1. Auth.
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Parse + validate.
    let body: TutorBody;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    const attemptId = body.attempt_id;
    const taskStep = body.task_step;
    const studentMessage = body.student_message;
    const isHelpRequest = body.is_help_request;
    if (!attemptId || typeof studentMessage !== 'string' || !studentMessage.trim()
      || typeof taskStep !== 'number' || typeof isHelpRequest !== 'boolean') {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();

    // 3. Ownership-load (existence-hiding). 404 on null; 409 on a graded attempt.
    const { data: attemptRow } = await admin.from('homework_attempts')
      .select('id, student_id, assignment_id, status')
      .eq('id', attemptId).eq('student_id', user.id).maybeSingle();
    const attempt = attemptRow as { id: string; student_id: string; assignment_id: string; status: string } | null;
    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    if (attempt.status === 'graded') return NextResponse.json({ error: 'Already graded' }, { status: 409 });

    // 4. Find-or-create the ONE active session (partial-unique index makes this safe).
    let sessionId: string | null = null;
    const { data: existing } = await admin.from('tutor_sessions')
      .select('id')
      .eq('attempt_id', attempt.id).eq('student_id', user.id).eq('status', 'active')
      .maybeSingle();
    sessionId = (existing as { id?: string } | null)?.id ?? null;
    if (!sessionId) {
      const { data: created, error: insertErr } = await admin.from('tutor_sessions')
        .insert({ student_id: user.id, assignment_id: attempt.assignment_id, attempt_id: attempt.id, status: 'active' })
        .select('id').maybeSingle();
      sessionId = (created as { id?: string } | null)?.id ?? null;
      // Lost the create race (partial-unique 23505): re-select the existing active row.
      if (!sessionId && (insertErr as { code?: string } | null)?.code === '23505') {
        const { data: raced } = await admin.from('tutor_sessions')
          .select('id')
          .eq('attempt_id', attempt.id).eq('student_id', user.id).eq('status', 'active')
          .maybeSingle();
        sessionId = (raced as { id?: string } | null)?.id ?? null;
      }
    }
    if (!sessionId) return NextResponse.json({ error: 'Session unavailable' }, { status: 404 });

    // 5. Load the task text.
    const { data: aRow } = await admin.from('assignments').select('content').eq('id', attempt.assignment_id).maybeSingle();
    const content = normalizeContent((aRow as { content?: AssignmentContent } | null)?.content ?? null);
    const tasks = (content.tasks ?? []) as Array<{ step: number; description: string }>;
    const taskDescription = tasks.find(t => t.step === taskStep)?.description
      ?? 'this task';

    // 6. Insert the STUDENT turn FIRST (count-after-insert kills the rung race).
    await admin.from('tutor_messages').insert({
      session_id: sessionId, task_step: taskStep, role: 'student',
      content: studentMessage, is_help_request: isHelpRequest,
    });

    // 7. Decide the rung (help turns only) + advance counters.
    let rung: HintRung | null = null;
    let remaining: number | null = null;
    if (isHelpRequest) {
      const { count } = await admin.from('tutor_messages')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId).eq('task_step', taskStep)
        .eq('role', 'student').eq('is_help_request', true);
      const priorHelpCount = (count ?? 1) - 1; // the row just inserted is included.
      rung = rungForHelpCount(priorHelpCount);
      remaining = hintsRemaining(priorHelpCount);
      await admin.rpc('bump_tutor_session', { p_session_id: sessionId });
    } else {
      await admin.from('tutor_sessions').update({ last_activity_at: new Date().toISOString() }).eq('id', sessionId);
    }

    // 8. Generate the guarded reply (ALWAYS a checked, safe string).
    const reply = await generateGuardedHint({
      taskDescription, rung, isHelpRequest, studentMessage,
    });

    // 9. Insert the TELI turn (is_help_request:false so the help count never doubles).
    await admin.from('tutor_messages').insert({
      session_id: sessionId, task_step: taskStep, role: 'teli',
      content: reply, is_help_request: false, hint_rung: rung,
    });

    // 10. Respond.
    return NextResponse.json({ reply, hint_rung: rung, hints_remaining: remaining });
  } catch (err) {
    console.error('[homework-tutor] error:', err);
    return NextResponse.json({ error: 'Tutor unavailable' }, { status: 500 });
  }
}
