// src/app/(school-admin)/admin/students/_components/AttentionRollup.tsx
// Grade → class → student rollup for the Student Attention page.
// Band-level/soft copy only; NO raw risk numbers; quiet-when-empty.
// Each student row links to the admin-scoped drill-in (/admin/students/<id>),
// NOT the teacher path (/students/<id>) which runs requireRole(['teacher']).

import Link from 'next/link';
import { Card } from '@/components/core/Card';
import type {
  AttentionRollupData,
  AttentionClass,
} from '@/lib/school/loadStudentAttention';

// ── Sub-components ─────────────────────────────────────────────────────────

function ClassSection({ cls }: { cls: AttentionClass }) {
  const count = cls.students.length;
  return (
    <div className="space-y-2">
      <p className="text-fg-muted text-xs font-semibold uppercase tracking-wide">
        {cls.className} &mdash; {count} {count === 1 ? 'student' : 'students'} to check
      </p>
      <ul className="space-y-1" role="list">
        {cls.students.map(student => (
          <li key={student.studentId}>
            <Link
              href={`/admin/students/${student.studentId}`}
              className="flex items-center justify-between gap-2 rounded-md border border-sidebar-edge px-3 py-2 text-sm hover:bg-brand-surface transition-colors"
              aria-label={`View ${student.name ?? 'student'} — Building`}
            >
              <span className="text-fg font-medium">
                {student.name ?? 'Unnamed student'}
              </span>
              <span className="text-fg-muted text-xs shrink-0">Building</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function AttentionRollup({ data }: { data: AttentionRollupData }) {
  if (data.grades.length === 0) {
    return (
      <Card className="py-10 text-center">
        <p className="text-fg-muted text-sm">No students need attention right now.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {data.grades.map(grade => (
        <Card key={grade.grade}>
          <h2 className="text-fg font-display text-lg font-bold mb-4">
            Grade {grade.grade}
          </h2>
          <div className="space-y-5">
            {grade.classes.map(cls => (
              <ClassSection key={cls.classId} cls={cls} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export default AttentionRollup;
