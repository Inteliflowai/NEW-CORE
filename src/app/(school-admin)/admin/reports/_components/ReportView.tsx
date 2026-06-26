// src/app/(school-admin)/admin/reports/_components/ReportView.tsx
// Operational school report: summary stat cards + per-class rollup table +
// a Download CSV anchor.  Token-only — no hardcoded hex or sizes.
// NO per-student data. Server component (no 'use client' needed).
import type { SchoolReport } from '@/lib/school/loadSchoolReport';
import { Card } from '@/components/core/Card';

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: SchoolReport }) {
  const stats: Array<{ label: string; value: number }> = [
    { label: 'Students', value: data.totalStudents },
    { label: 'Teachers', value: data.totalTeachers },
    { label: 'Classes', value: data.totalClasses },
    { label: 'Assignments turned in', value: data.totalAssignmentsSubmitted },
    { label: 'Quizzes published', value: data.totalQuizzesPublished },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {stats.map(({ label, value }) => (
        <Card key={label} className="space-y-1">
          <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
            {label}
          </p>
          <p className="text-fg text-3xl font-display font-bold leading-tight">
            {value}
          </p>
        </Card>
      ))}
    </div>
  );
}

// ── Per-class table ───────────────────────────────────────────────────────────

function ClassesTable({ classes }: { classes: SchoolReport['classes'] }) {
  if (classes.length === 0) {
    return (
      <Card>
        <p className="text-fg-muted text-sm italic">No active classes yet.</p>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto p-4">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th
                scope="col"
                className="text-left text-fg-muted text-xs font-medium pb-2 pr-4"
              >
                Class
              </th>
              <th
                scope="col"
                className="text-left text-fg-muted text-xs font-medium pb-2 pr-4"
              >
                Teacher
              </th>
              <th
                scope="col"
                className="text-right text-fg-muted text-xs font-medium pb-2 pr-3"
              >
                Students enrolled
              </th>
              <th
                scope="col"
                className="text-right text-fg-muted text-xs font-medium pb-2 pr-3"
              >
                Assignments created
              </th>
              <th
                scope="col"
                className="text-right text-fg-muted text-xs font-medium pb-2 pr-3"
              >
                Turned in
              </th>
              <th
                scope="col"
                className="text-right text-fg-muted text-xs font-medium pb-2"
              >
                Quizzes published
              </th>
            </tr>
          </thead>
          <tbody>
            {classes.map(c => (
              <tr key={c.classId} className="border-t border-sidebar-edge/30">
                <td className="text-fg py-2 pr-4 font-medium">{c.className}</td>
                <td className="text-fg-muted py-2 pr-4">
                  {c.teacherName ?? <span className="italic">Unassigned</span>}
                </td>
                <td className="text-right text-fg py-2 pr-3">
                  {c.enrolledStudents}
                </td>
                <td className="text-right text-fg py-2 pr-3">
                  {c.assignmentsCreated}
                </td>
                <td className="text-right text-fg py-2 pr-3">
                  {c.assignmentsSubmitted}
                </td>
                <td className="text-right text-fg py-2">
                  {c.quizzesPublished}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ReportViewProps {
  data: SchoolReport;
  /** The effective schoolId — used to build the CSV download URL. */
  schoolId: string;
}

export function ReportView({ data, schoolId }: ReportViewProps) {
  // The route ignores ?school= for non-platform admins (they're pinned to their
  // own school), so it's safe and convenient to always include it.
  const csvHref = `/api/admin/school-report?school=${encodeURIComponent(schoolId)}`;

  return (
    <div className="space-y-6">
      {/* Header: school name + download action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-fg-muted text-sm">
          Operational summary for{' '}
          <span className="text-fg font-semibold">{data.schoolName}</span>
        </p>
        <a
          href={csvHref}
          download="school-report.csv"
          className="inline-flex items-center gap-2 rounded-lg border-2 border-sidebar-edge bg-brand px-3 py-1.5 text-sm font-semibold text-fg-on-brand shadow-sticker hover:opacity-90 transition-opacity"
        >
          Download CSV
        </a>
      </div>

      {/* Summary stat cards */}
      <SummaryCards data={data} />

      {/* Per-class rollup */}
      <div className="space-y-2">
        <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
          By class
        </p>
        <ClassesTable classes={data.classes} />
      </div>
    </div>
  );
}

export default ReportView;
