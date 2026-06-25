// Two service-role DB readers for the silent-SSO launch (Seg 4). The link id is NEVER trusted for
// identity — these only DERIVE the candidate school (to scope resolveExternalIdentity) and the
// student's OWN deep-link target. Callers pair these with the launch-state + Google-identity gates.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LaunchGc } from '@/lib/google/launchState';

/** Derive the class + school that own the launched resource. The school scopes identity
 *  resolution; the class is the active-enrollment gate (M2). quiz → quizzes.class_id; assignment
 *  (lesson) → lessons.class_id; then classes.school_id. Returns null when the resource or its
 *  class doesn't exist. */
export async function deriveResourceSchool(
  admin: SupabaseClient,
  gc: LaunchGc,
  id: string,
): Promise<{ schoolId: string; classId: string } | null> {
  const table = gc === 'quiz' ? 'quizzes' : 'lessons';
  const { data: res } = await admin.from(table).select('class_id').eq('id', id).maybeSingle();
  const classId = (res as { class_id?: string } | null)?.class_id;
  if (!classId) return null;
  const { data: cls } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  return schoolId ? { schoolId, classId } : null;
}

/** Resolve the student's OWN deep-link destination for a launched resource.
 *  assignment → the student's assignments row for that lesson → /student/assignments/<rowId>
 *    (the lookup IS an ownership proof; none → the list). quiz → /student/quiz?quizId=<id>
 *    (the EXACT published quiz; the student-quiz route re-gates published + active-enrollment, so
 *    the public link id can never surface a draft or a quiz outside the student's enrolled classes).
 *  LIMITATION (m8): a lesson can fan out to multiple per-student assignment rows (multi-day, or an
 *  A.2 Reinforce easier-work row mastery_band='reteach'); GC publish is lesson-keyed so the link
 *  can't distinguish them — this resolves to the MOST-RECENT row for the lesson, else the list.
 *  Always the student's OWN row (four-audience safe).
 *  The result is always an internal /student path; callers still run safeStudentDest. */
export async function resolveGcDeepLink(
  admin: SupabaseClient,
  args: { studentId: string; gc: LaunchGc; id: string },
): Promise<string> {
  if (args.gc === 'assignment') {
    const { data } = await admin
      .from('assignments')
      .select('id')
      .eq('student_id', args.studentId)
      .eq('lesson_id', args.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const rowId = (data as { id?: string } | null)?.id;
    return rowId ? `/student/assignments/${rowId}` : '/student/assignments';
  }
  return `/student/quiz?quizId=${encodeURIComponent(args.id)}`;
}
