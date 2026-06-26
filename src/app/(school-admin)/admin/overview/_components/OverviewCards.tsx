// src/app/(school-admin)/admin/overview/_components/OverviewCards.tsx
// Renders the school overview in three Pop-Art cards: License & Seats,
// At a Glance (counts), and This Week (activity). Token-only — no hardcoded hex.
// Restraint rule: ≤ a few numbers per card. No per-student data.
import type { SchoolOverview } from '@/lib/school/loadSchoolOverview';
import { Card, StatCard } from '@/components/core/Card';

type CardTone = 'surface' | 'brand' | 'ok' | 'warn' | 'risk';

// ── Helpers ──────────────────────────────────────────────────────────────────

function seatsTone(used: number, limit: number | null): CardTone {
  if (!limit || limit === 0) return 'surface';
  const frac = used / limit;
  if (frac >= 0.9) return 'risk';
  if (frac >= 0.75) return 'warn';
  return 'surface';
}

function statusTone(status: string | null): CardTone {
  if (!status) return 'surface';
  if (status === 'active' || status === 'trialing') return 'ok';
  if (status === 'suspended' || status === 'cancelled') return 'risk';
  if (status === 'past_due') return 'warn';
  return 'surface';
}

function formatTier(tier: string | null): string {
  if (!tier) return 'No license';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatStatus(status: string | null): string {
  if (!status) return '—';
  const map: Record<string, string> = {
    active: 'Active',
    trialing: 'Trial',
    past_due: 'Past due',
    suspended: 'Suspended',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}

function formatTrialEnds(trialEndsAt: string | null): string | null {
  if (!trialEndsAt) return null;
  const d = new Date(trialEndsAt);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Sub-cards ─────────────────────────────────────────────────────────────────

function LicenseSeatsCard({ data }: { data: SchoolOverview }) {
  const { license, seatsUsed } = data;
  const tone = seatsTone(seatsUsed, license.studentLimit);
  const trialEndDate = formatTrialEnds(license.trialEndsAt);

  return (
    <Card tone={tone} className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">License</p>
          <p className="text-fg text-xl font-display font-bold leading-tight">
            {formatTier(license.tier)}
          </p>
        </div>
        <span
          className={[
            'text-xs font-semibold px-2 py-0.5 rounded border-2 border-sidebar-edge',
            statusTone(license.status) === 'ok'
              ? 'bg-ok text-fg'
              : statusTone(license.status) === 'risk'
                ? 'bg-risk text-fg'
                : statusTone(license.status) === 'warn'
                  ? 'bg-warn text-fg'
                  : 'bg-surface text-fg-muted',
          ].join(' ')}
        >
          {formatStatus(license.status)}
        </span>
      </div>

      <div>
        <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">Seats</p>
        <p className="text-fg text-xl font-display font-bold leading-tight">
          {seatsUsed}
          {license.studentLimit !== null && (
            <span className="text-fg-muted text-sm font-normal"> / {license.studentLimit}</span>
          )}
        </p>
        {tone !== 'surface' && license.studentLimit !== null && (
          <p className="text-fg-muted text-xs mt-0.5">
            {tone === 'risk' ? 'Approaching seat limit' : 'Nearing seat limit'}
          </p>
        )}
      </div>

      {trialEndDate && (
        <p className="text-fg-muted text-xs">
          Trial ends <span className="text-fg font-medium">{trialEndDate}</span>
        </p>
      )}
    </Card>
  );
}

function CountsCard({ counts }: { counts: SchoolOverview['counts'] }) {
  return (
    <Card className="space-y-3">
      <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">At a Glance</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-fg text-2xl font-display font-bold leading-tight">{counts.students}</p>
          <p className="text-fg-muted text-xs">Students</p>
        </div>
        <div>
          <p className="text-fg text-2xl font-display font-bold leading-tight">{counts.teachers}</p>
          <p className="text-fg-muted text-xs">Teachers</p>
        </div>
        <div>
          <p className="text-fg text-2xl font-display font-bold leading-tight">{counts.classes}</p>
          <p className="text-fg-muted text-xs">Classes</p>
        </div>
      </div>
    </Card>
  );
}

function ThisWeekCard({ thisWeek }: { thisWeek: SchoolOverview['thisWeek'] }) {
  const alertTone: CardTone = thisWeek.openAlerts > 0 ? 'warn' : 'surface';

  return (
    <Card className="space-y-3">
      <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">This Week</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-fg text-2xl font-display font-bold leading-tight">
            {thisWeek.assignmentsSubmitted}
          </p>
          <p className="text-fg-muted text-xs">Assignments turned in</p>
        </div>
        <div>
          <p className="text-fg text-2xl font-display font-bold leading-tight">
            {thisWeek.quizzesPublished}
          </p>
          <p className="text-fg-muted text-xs">Quizzes published</p>
        </div>
        <div>
          <p
            className={[
              'text-2xl font-display font-bold leading-tight',
              alertTone === 'warn' ? 'text-warn' : 'text-fg',
            ].join(' ')}
          >
            {thisWeek.openAlerts}
          </p>
          <p className="text-fg-muted text-xs">Open alerts</p>
        </div>
        <div>
          <p className="text-fg text-2xl font-display font-bold leading-tight">
            {thisWeek.highFives}
          </p>
          <p className="text-fg-muted text-xs">High-fives sent</p>
        </div>
      </div>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface OverviewCardsProps {
  data: SchoolOverview;
  /** school_admin only: total students in the 'reteach' band across all classes.
   *  null = not available for this role (sysadmin). 0 = no students need a look. */
  studentsNeedingAttention?: number | null;
  /** school_admin only: number of classes that contain at least one attention student. */
  classesNeedingAttention?: number | null;
}

export function OverviewCards({
  data,
  studentsNeedingAttention,
  classesNeedingAttention,
}: OverviewCardsProps) {
  return (
    <div className="space-y-6">
      <h1 className="text-fg font-display text-2xl font-bold">{data.schoolName}</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LicenseSeatsCard data={data} />
        <CountsCard counts={data.counts} />
        <ThisWeekCard thisWeek={data.thisWeek} />
      </div>
      {studentsNeedingAttention != null && studentsNeedingAttention > 0 && (
        <div className="mt-4 p-3 border border-warn rounded-md">
          <a href="/admin/students" className="text-fg text-sm font-medium hover:underline">
            {studentsNeedingAttention}{' '}
            {studentsNeedingAttention === 1 ? 'student' : 'students'} across{' '}
            {classesNeedingAttention}{' '}
            {classesNeedingAttention === 1 ? 'class' : 'classes'} may need a look this week →
          </a>
        </div>
      )}
    </div>
  );
}

// StatCard is re-exported to keep the import footprint tidy for any future
// sibling components that need a single-stat layout.
export { StatCard };

export default OverviewCards;
