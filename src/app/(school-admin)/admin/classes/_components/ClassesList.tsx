// src/app/(school-admin)/admin/classes/_components/ClassesList.tsx
// Renders the school-admin Classes & Roster view as expandable cards.
// Each class row shows: name, subject, grade, teacher, enrollment, and a
// Google Classroom badge when googleSynced is true.
// Click-expand (native <details>/<summary> — no JS required) reveals the
// roster table for that class.
// No per-student diagnostics. Token-only: no hardcoded hex.

import Link from 'next/link';
import type { SchoolClass } from '@/lib/school/loadSchoolClasses';
import type { ClassRosterStudent } from '@/lib/school/loadClassRoster';
import { Card } from '@/components/core/Card';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClassWithRoster {
  cls: SchoolClass;
  students: ClassRosterStudent[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? singular + 's')}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function GoogleBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-surface px-2 py-0.5 text-xs font-semibold text-brand"
      title="Synced with Google Classroom"
      aria-label="Google Classroom synced"
    >
      GC
    </span>
  );
}

function RosterTable({ students }: { students: ClassRosterStudent[] }) {
  if (students.length === 0) {
    return (
      <p className="text-fg-muted text-sm italic px-4 py-3">
        No students enrolled yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sidebar-edge">
            <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Name
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Email
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Active
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map(s => (
            <tr
              key={s.id}
              className={[
                'border-b border-sidebar-edge/50 last:border-0',
                !s.active && 'opacity-60',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <td className="px-4 py-2 text-fg font-medium">
                {s.name ?? <span className="text-fg-muted italic">No name</span>}
              </td>
              <td className="px-4 py-2 text-fg-muted">
                {s.email ?? '—'}
              </td>
              <td className="px-4 py-2">
                {s.active ? (
                  <span className="text-ok font-semibold">Yes</span>
                ) : (
                  <span className="text-fg-muted">No</span>
                )}
              </td>
              <td className="px-4 py-2 text-fg-muted capitalize">
                {s.source ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassRow({ item }: { item: ClassWithRoster }) {
  const { cls, students } = item;

  const meta = [
    cls.subject,
    cls.grade ? `Grade ${cls.grade}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card className="p-0 overflow-hidden">
      <details>
        <summary
          className={[
            'flex items-center justify-between gap-4 px-4 py-3 cursor-pointer',
            'hover:bg-brand-surface transition-colors list-none',
            '[&::-webkit-details-marker]:hidden',
          ].join(' ')}
          aria-label={[
            cls.name,
            meta,
            cls.teacherName ? `Teacher: ${cls.teacherName}` : null,
            plural(cls.enrollment, 'student'),
            cls.googleSynced ? 'Google Classroom synced' : null,
          ]
            .filter(Boolean)
            .join(', ')}
        >
          {/* Left: class name + meta */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-fg font-semibold truncate">{cls.name}</p>
              {cls.googleSynced && <GoogleBadge />}
            </div>
            {(meta || cls.teacherName) && (
              <p className="text-fg-muted text-xs mt-0.5">
                {[meta, cls.teacherName ? `· ${cls.teacherName}` : null]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )}
          </div>

          {/* Right: enrollment + expand hint */}
          <div className="flex items-center gap-4 shrink-0 text-right">
            <div>
              <p className="text-fg font-semibold text-sm">{cls.enrollment}</p>
              <p className="text-fg-muted text-xs">students</p>
            </div>
            <span className="text-fg-muted text-sm select-none" aria-hidden>
              ▾
            </span>
          </div>
        </summary>

        {/* Roster table (shown on expand) */}
        <div className="border-t border-sidebar-edge bg-surface">
          <RosterTable students={students} />
        </div>
      </details>
    </Card>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function ClassesList({ items }: { items: ClassWithRoster[] }) {
  if (items.length === 0) {
    return (
      <Card className="text-center py-10">
        <p className="text-fg-muted text-sm">No active classes in this school yet.</p>
        <p className="text-fg-muted text-xs mt-2">
          <Link href="/import" className="underline hover:text-fg">
            Import a roster
          </Link>{' '}
          to get started.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
          {plural(items.length, 'class', 'classes')} — click a row to see roster
        </p>
        <Link
          href="/import"
          className="text-xs font-semibold text-brand underline hover:no-underline"
        >
          Import roster
        </Link>
      </div>
      {items.map(item => (
        <ClassRow key={item.cls.id} item={item} />
      ))}
    </div>
  );
}

export default ClassesList;
