// src/lib/parent/loadChildTeachers.ts
// Resolve the teacher(s) of a child's active classes for the Contact Teacher
// card. child → active enrollments → classes.teacher_id → users(email,name).
// A student may be in several classes (demo: English Lit + Math), so this can
// return >1 teacher; dedupe by teacher and merge their class labels.
// mailto only — no message is stored. admin client + explicit student_id scope.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChildTeacher { teacherId: string; name: string; email: string; classLabel: string }

/** Collapse rows to one per teacher; join distinct class labels with " · ". */
export function dedupeTeachers(
  rows: { teacherId: string; name: string; email: string; className: string }[],
): ChildTeacher[] {
  const byId = new Map<string, { name: string; email: string; classes: string[] }>();
  for (const r of rows) {
    const cur = byId.get(r.teacherId);
    if (cur) {
      if (!cur.classes.includes(r.className)) cur.classes.push(r.className);
    } else {
      byId.set(r.teacherId, { name: r.name, email: r.email, classes: [r.className] });
    }
  }
  return [...byId.entries()].map(([teacherId, v]) => ({
    teacherId,
    name: v.name,
    email: v.email,
    classLabel: v.classes.join(' · '),
  }));
}

export async function loadChildTeachers(admin: SupabaseClient, studentId: string): Promise<ChildTeacher[]> {
  const { data: enr } = await admin
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('is_active', true);
  const classIds = (enr ?? []).map((e: { class_id: string }) => e.class_id);
  if (classIds.length === 0) return [];

  const { data: classes } = await admin
    .from('classes')
    .select('id, name, subject, teacher_id')
    .in('id', classIds);
  const classRows = (classes ?? []) as { id: string; name: string; subject: string | null; teacher_id: string | null }[];
  const teacherIds = [...new Set(classRows.map((c) => c.teacher_id).filter((t): t is string => t != null))];
  if (teacherIds.length === 0) return [];

  const { data: users } = await admin
    .from('users')
    .select('id, email, display_name, full_name')
    .in('id', teacherIds)
    .eq('role', 'teacher');
  const teacherById = new Map(
    ((users ?? []) as { id: string; email: string; display_name: string | null; full_name: string | null }[])
      .map((u) => [u.id, { email: u.email, name: u.display_name || u.full_name || 'Teacher' }]),
  );

  const rows = classRows
    .filter((c) => c.teacher_id && teacherById.has(c.teacher_id))
    .map((c) => {
      const t = teacherById.get(c.teacher_id as string)!;
      return { teacherId: c.teacher_id as string, name: t.name, email: t.email, className: c.subject || c.name };
    });

  return dedupeTeachers(rows);
}
