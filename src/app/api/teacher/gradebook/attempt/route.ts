// src/app/api/teacher/gradebook/attempt/route.ts
// GET ?attemptId= — on-demand detail for the gradebook drill-in's "Student's work" panel:
// the assignment tasks + the student's per-task answers (text + drawing proxy URLs) + AI feedback.
// Kept OFF the main gradebook loader so per-cell payloads stay light. Auth mirrors gradebook/trend:
// getUser → STAFF_ROLES → guardClassAccess(class_id) (IDOR; RLS is NOT the backstop).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { normalizeContent, type AssignmentContent } from '@/lib/assignments/loadAssignmentForPlay';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const attemptId = new URL(req.url).searchParams.get('attemptId');
  if (!attemptId) return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: attempt } = await admin.from('homework_attempts')
    .select('id, assignment_id, responses, ai_feedback, status').eq('id', attemptId).maybeSingle();
  const a = attempt as { id: string; assignment_id: string; responses: unknown; ai_feedback: unknown; status: string } | null;
  if (!a) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

  const { data: asg } = await admin.from('assignments').select('id, class_id, content').eq('id', a.assignment_id).maybeSingle();
  const assignment = asg as { class_id: string; content: AssignmentContent | null } | null;
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const guard = await guardClassAccess(assignment.class_id);
  if (guard) return guard;

  const content = normalizeContent(assignment.content);
  const tasks = (content.tasks ?? []).map((t) => ({ step: t.step, description: t.description }));
  const responses = (a.responses as { tasks?: Record<string, { text?: string; image_url?: string | null }> } | null) ?? { tasks: {} };
  const aiFeedback = (a.ai_feedback as { overall?: string } | null) ?? null;

  return NextResponse.json({ tasks, responses, ai_feedback: aiFeedback, status: a.status });
}
