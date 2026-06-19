'use client';

/**
 * src/app/(super-admin)/provision/page.tsx
 *
 * Minimal provisioning UI for platform admins.
 * POSTs to POST /api/admin/provision-trial and renders the result summary.
 * Token classes only — no raw hex or arbitrary [var(--..)] values.
 */

import { useState } from 'react';

interface CredentialEntry {
  email: string;
}

interface CredentialsSummary {
  shared_password: string;
  accounts?: Record<string, CredentialEntry>;
}

interface ProvisionResult {
  school_id: string;
  trial_expires_at: string;
  roster_status?: string;
  credentials_summary: CredentialsSummary;
}

const TRIAL_PLANS = [
  { value: 'pro', label: 'Pro' },
  { value: 'starter', label: 'Starter' },
  { value: 'enterprise', label: 'Enterprise' },
];

export default function ProvisionPage() {
  const [schoolName, setSchoolName] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [roster, setRoster] = useState('');
  const [trialPlan, setTrialPlan] = useState('pro');
  const [studentLimit, setStudentLimit] = useState(300);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setErrorMsg(null);

    const student_roster = roster
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch('/api/admin/provision-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_name: schoolName,
          teacher_name: teacherName,
          teacher_email: teacherEmail,
          student_roster,
          trial_plan: trialPlan,
          student_limit: studentLimit,
        }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        setErrorMsg((data.error as string) ?? `Request failed (${res.status})`);
      } else {
        setResult(data as unknown as ProvisionResult);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-fg mb-6">Provision Trial School</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* School name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="school-name" className="text-sm font-medium text-fg">
            School name
          </label>
          <input
            id="school-name"
            type="text"
            required
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            className="rounded border border-fg-muted bg-surface text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            placeholder="Westfield Academy"
          />
        </div>

        {/* Teacher name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="teacher-name" className="text-sm font-medium text-fg">
            Teacher name
          </label>
          <input
            id="teacher-name"
            type="text"
            required
            value={teacherName}
            onChange={(e) => setTeacherName(e.target.value)}
            className="rounded border border-fg-muted bg-surface text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            placeholder="Jane Smith"
          />
        </div>

        {/* Teacher email */}
        <div className="flex flex-col gap-1">
          <label htmlFor="teacher-email" className="text-sm font-medium text-fg">
            Teacher email
          </label>
          <input
            id="teacher-email"
            type="email"
            required
            value={teacherEmail}
            onChange={(e) => setTeacherEmail(e.target.value)}
            className="rounded border border-fg-muted bg-surface text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            placeholder="teacher@school.edu"
          />
        </div>

        {/* Student roster */}
        <div className="flex flex-col gap-1">
          <label htmlFor="student-roster" className="text-sm font-medium text-fg">
            Student roster <span className="text-fg-muted font-normal">(one name per line, optional — demo cast seeded if blank)</span>
          </label>
          <textarea
            id="student-roster"
            rows={6}
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            className="rounded border border-fg-muted bg-surface text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-y"
            placeholder={"Alex Johnson\nSofia Martinez\nMarcus Williams"}
          />
        </div>

        {/* Trial plan */}
        <div className="flex flex-col gap-1">
          <label htmlFor="trial-plan" className="text-sm font-medium text-fg">
            Trial plan
          </label>
          <select
            id="trial-plan"
            value={trialPlan}
            onChange={(e) => setTrialPlan(e.target.value)}
            className="rounded border border-fg-muted bg-surface text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {TRIAL_PLANS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Student limit */}
        <div className="flex flex-col gap-1">
          <label htmlFor="student-limit" className="text-sm font-medium text-fg">
            Student limit
          </label>
          <input
            id="student-limit"
            type="number"
            min={1}
            max={10000}
            required
            value={studentLimit}
            onChange={(e) => setStudentLimit(Number(e.target.value))}
            className="rounded border border-fg-muted bg-surface text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded bg-brand text-fg-on-brand px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? 'Provisioning…' : 'Provision trial school'}
        </button>
      </form>

      {/* Error state */}
      {errorMsg && (
        <div role="alert" className="mt-6 rounded bg-risk-surface text-risk-fg px-4 py-3 text-sm">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Success state */}
      {result && (
        <section aria-label="Provision result" className="mt-6 rounded bg-ok-surface text-ok-fg px-4 py-4 text-sm space-y-2">
          <h2 className="font-semibold text-base text-fg mb-1">Trial provisioned</h2>
          <p>
            <span className="font-medium text-fg">School ID:</span>{' '}
            <code className="text-fg-muted">{result.school_id}</code>
          </p>
          <p>
            <span className="font-medium text-fg">Trial expires:</span>{' '}
            {new Date(result.trial_expires_at).toLocaleDateString()}
          </p>
          <div>
            <p className="font-medium text-fg mb-1">Credentials (share once — not stored in logs):</p>
            {result.credentials_summary.accounts && (
              <ul className="space-y-1 pl-4 list-disc">
                {Object.entries(result.credentials_summary.accounts).map(([role, cred]) => (
                  <li key={role}>
                    <span className="capitalize text-fg">{role}:</span>{' '}
                    <code className="text-fg-muted">{cred.email}</code>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2">
              <span className="font-medium text-fg">Shared password:</span>{' '}
              <code className="text-brand font-mono">{result.credentials_summary.shared_password}</code>
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
