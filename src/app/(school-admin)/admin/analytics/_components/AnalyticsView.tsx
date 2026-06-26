// src/app/(school-admin)/admin/analytics/_components/AnalyticsView.tsx
// Calm, aggregate-only analytics view for school admins.
// No per-student data — only aggregate counts (weekly totals, per-class
// completion, and two adoption numbers). Token-only; no hardcoded hex.
import type { SchoolAnalytics } from '@/lib/school/loadSchoolAnalytics';
import { Card } from '@/components/core/Card';

// ── Helpers ───────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? singular + 's')}`;
}

function formatWeekLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── Adoption card ─────────────────────────────────────────────────────────────

function AdoptionCard({ adoption }: { adoption: SchoolAnalytics['adoption'] }) {
  const { teachersActive, studentsActive } = adoption;
  const tone =
    teachersActive === 0 && studentsActive === 0 ? 'surface' : 'ok';

  return (
    <Card tone={tone} className="space-y-3">
      <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
        Active this week
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-fg text-3xl font-display font-bold leading-tight">
            {teachersActive}
          </p>
          <p className="text-fg-muted text-xs">
            {plural(teachersActive, 'teacher')} active
          </p>
        </div>
        <div>
          <p className="text-fg text-3xl font-display font-bold leading-tight">
            {studentsActive}
          </p>
          <p className="text-fg-muted text-xs">
            {plural(studentsActive, 'student')} active
          </p>
        </div>
      </div>
    </Card>
  );
}

// ── Weekly trend card ─────────────────────────────────────────────────────────

function WeeklyTrendCard({ weeks }: { weeks: SchoolAnalytics['weeks'] }) {
  const totalAssignments = weeks.reduce((s, w) => s + w.assignmentsSubmitted, 0);
  const totalQuizzes = weeks.reduce((s, w) => s + w.quizzesPublished, 0);

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
          Weekly activity — last 8 weeks
        </p>
        {(totalAssignments > 0 || totalQuizzes > 0) && (
          <p className="text-fg-muted text-xs text-right shrink-0">
            {totalAssignments} submitted · {totalQuizzes} published
          </p>
        )}
      </div>

      {totalAssignments === 0 && totalQuizzes === 0 ? (
        <p className="text-fg-muted text-sm italic">No activity yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-left text-fg-muted text-xs font-medium pb-2 pr-4"
                >
                  Week of
                </th>
                <th
                  scope="col"
                  className="text-right text-fg-muted text-xs font-medium pb-2 pr-4"
                >
                  Assignments turned in
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
              {[...weeks].reverse().map((w) => {
                const isCurrentWeek = w === weeks[weeks.length - 1];
                return (
                  <tr
                    key={w.weekStart}
                    className={isCurrentWeek ? 'font-semibold' : ''}
                  >
                    <td className="text-fg py-1 pr-4 whitespace-nowrap">
                      {formatWeekLabel(w.weekStart)}
                      {isCurrentWeek && (
                        <span className="ml-1.5 text-[10px] font-bold text-brand uppercase tracking-wide">
                          this week
                        </span>
                      )}
                    </td>
                    <td className="text-right text-fg py-1 pr-4">
                      {w.assignmentsSubmitted > 0 ? w.assignmentsSubmitted : '—'}
                    </td>
                    <td className="text-right text-fg py-1">
                      {w.quizzesPublished > 0 ? w.quizzesPublished : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Classes card ──────────────────────────────────────────────────────────────

function ClassesCard({ classes }: { classes: SchoolAnalytics['classes'] }) {
  const active = classes.filter(c => c.activity > 0);

  return (
    <Card className="space-y-3">
      <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">
        By class
      </p>

      {classes.length === 0 ? (
        <p className="text-fg-muted text-sm italic">No active classes yet.</p>
      ) : active.length === 0 ? (
        <p className="text-fg-muted text-sm italic">No assignment activity recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
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
                  className="text-right text-fg-muted text-xs font-medium pb-2 pr-4"
                >
                  Graded / submitted
                </th>
                <th
                  scope="col"
                  className="text-right text-fg-muted text-xs font-medium pb-2"
                >
                  Attempts
                </th>
              </tr>
            </thead>
            <tbody>
              {classes
                .slice()
                .sort((a, b) => b.activity - a.activity)
                .map((c) => (
                  <tr key={c.name} className="border-t border-sidebar-edge/30">
                    <td className="text-fg py-1.5 pr-4 font-medium truncate max-w-[180px]">
                      {c.name}
                    </td>
                    <td className="text-right text-fg py-1.5 pr-4">
                      {c.activity > 0 ? `${c.completionPct}%` : '—'}
                    </td>
                    <td className="text-right text-fg-muted py-1.5">
                      {c.activity > 0 ? c.activity : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AnalyticsView({ data }: { data: SchoolAnalytics }) {
  return (
    <div className="space-y-4">
      <AdoptionCard adoption={data.adoption} />
      <WeeklyTrendCard weeks={data.weeks} />
      <ClassesCard classes={data.classes} />
    </div>
  );
}

export default AnalyticsView;
