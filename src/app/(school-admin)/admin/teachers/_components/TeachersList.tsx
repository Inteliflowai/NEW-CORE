// src/app/(school-admin)/admin/teachers/_components/TeachersList.tsx
// Renders the school-admin teachers list as expandable cards.
// Each teacher row shows name, email, # classes, # students, last-active date.
// Click-expand (native <details>/<summary> — no JS required) reveals class rows.
// No risk/effectiveness/divergence — this is a plain directory view.
// Token-only: no hardcoded hex. No raw % or band labels.

import type { SchoolTeacher } from '@/lib/school/loadSchoolTeachers';
import { Card } from '@/components/core/Card';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLastActive(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? singular + 's')}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ClassRow({
  cls,
}: {
  cls: SchoolTeacher['classes'][number];
}) {
  const meta = [
    cls.subject,
    cls.grade ? `Grade ${cls.grade}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-sidebar-edge bg-surface px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="text-fg font-medium truncate">{cls.name}</span>
        {meta && (
          <span className="text-fg-muted ml-2 text-xs">{meta}</span>
        )}
      </div>
      <span className="shrink-0 text-fg-muted text-xs">
        {plural(cls.enrollment, 'student')}
      </span>
    </div>
  );
}

function TeacherRow({ teacher }: { teacher: SchoolTeacher }) {
  const hasClasses = teacher.classes.length > 0;

  return (
    <Card className="p-0 overflow-hidden">
      <details>
        <summary
          className={[
            'flex items-center justify-between gap-4 px-4 py-3 cursor-pointer',
            'hover:bg-brand-surface transition-colors list-none',
            '[&::-webkit-details-marker]:hidden',
          ].join(' ')}
          aria-label={`${teacher.name ?? 'Unknown teacher'}, ${plural(teacher.classes.length, 'class', 'classes')}, ${plural(teacher.studentCount, 'student')}`}
        >
          {/* Left: name + email */}
          <div className="min-w-0 flex-1">
            <p className="text-fg font-semibold truncate">
              {teacher.name ?? <span className="text-fg-muted italic">No name</span>}
            </p>
            {teacher.email && (
              <p className="text-fg-muted text-xs truncate">{teacher.email}</p>
            )}
          </div>

          {/* Right: stats */}
          <div className="flex items-center gap-4 shrink-0 text-right">
            <div className="hidden sm:block">
              <p className="text-fg font-semibold text-sm">{teacher.classes.length}</p>
              <p className="text-fg-muted text-xs">classes</p>
            </div>
            <div>
              <p className="text-fg font-semibold text-sm">{teacher.studentCount}</p>
              <p className="text-fg-muted text-xs">students</p>
            </div>
            <div className="hidden md:block min-w-[90px]">
              <p className="text-fg font-semibold text-sm">{formatLastActive(teacher.lastActive)}</p>
              <p className="text-fg-muted text-xs">last active</p>
            </div>
            {/* Chevron indicator */}
            <span
              className="text-fg-muted text-sm select-none"
              aria-hidden
            >
              ▾
            </span>
          </div>
        </summary>

        {/* Class rows (shown on expand) */}
        {hasClasses && (
          <div className="border-t border-sidebar-edge px-4 py-3 space-y-2 bg-surface">
            {teacher.classes.map(cls => (
              <ClassRow key={cls.id} cls={cls} />
            ))}
          </div>
        )}
        {!hasClasses && (
          <div className="border-t border-sidebar-edge px-4 py-3">
            <p className="text-fg-muted text-sm italic">No active classes.</p>
          </div>
        )}
      </details>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function TeachersList({ teachers }: { teachers: SchoolTeacher[] }) {
  if (teachers.length === 0) {
    return (
      <Card className="text-center py-10">
        <p className="text-fg-muted text-sm">No active teachers in this school yet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
        {plural(teachers.length, 'teacher')} — click a row to see classes
      </p>
      {teachers.map(t => (
        <TeacherRow key={t.id} teacher={t} />
      ))}
    </div>
  );
}

export default TeachersList;
