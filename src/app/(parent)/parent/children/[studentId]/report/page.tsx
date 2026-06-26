// src/app/(parent)/parent/children/[studentId]/report/page.tsx
//
// Printable parent report — period-over-period comparison in direction words only.
// Print-only surface: self-vs-own-past TEMPORAL comparison is allowed here, expressed
// in direction words (climbing/steady/sliding). NEVER digits, NEVER "compared to",
// NEVER another student.
//
// Auth chain:
//   requireRole(['parent'])      ← layout already guards, but we need userId
//   guardStudentAccess(studentId) ← object-level IDOR guard
//   redirect('/parent/dashboard') ← M3: on deny use redirect(), NOT return NextResponse
//
// Four-audience: zero numbers; ReportCard has render-time hasParentLeak guards.

import React from 'react';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/auth/requireRole';
import { guardStudentAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { perChildReportData } from '@/lib/parent/perChildReportData';

import { PrintButton } from './_components/PrintButton';
import { ReportCard } from './_components/ReportCard';

export default async function ChildReportPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}): Promise<React.JSX.Element> {
  const { studentId } = await params;

  // ── Auth ────────────────────────────────────────────────────────────────────
  await requireRole(['parent']);

  // ── IDOR guard: Server Component must redirect(), never return NextResponse ──
  const denied = await guardStudentAccess(studentId);
  if (denied) redirect('/parent/dashboard');

  // ── Data ────────────────────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  const report = await perChildReportData(admin, studentId);

  // CS-3: Render the report date without digits — month name only so no 4-digit
  // calendar year leaks onto a zero-number surface.
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });

  return (
    <>
      {/*
        Print CSS: hide the shell header (nav) and the PrintButton on print.
        Tailwind's print: variant covers the button; this style block targets
        the RoleLayout <header> which is outside this component's scope.
      */}
      <style>{`
        @media print {
          [data-role] > header { display: none !important; }
          .print-hide { display: none !important; }
        }
      `}</style>

      <div className="p-8 max-w-2xl mx-auto flex flex-col gap-8">
        {/* Print action — hidden when printing */}
        <div className="print-hide flex items-center justify-between">
          <a
            href="/parent/reports"
            className="text-xs text-fg-muted hover:text-brand transition-colors"
          >
            ← Back to Reports
          </a>
          <PrintButton />
        </div>

        {/* Report header */}
        <header className="flex flex-col gap-1 border-b border-surface pb-6">
          <p className="text-xs text-fg-muted uppercase tracking-wide">
            Learning Report · {currentMonth}
          </p>
          <h1 className="font-display text-fg text-2xl">
            {report.firstName}&apos;s Progress Summary
          </h1>
          <p className="text-fg-muted text-sm">
            A personal view of {report.firstName}&apos;s learning journey —
            growth over time, topics explored, and how they engage with new ideas.
          </p>
        </header>

        {/* Main report content */}
        <ReportCard report={report} />

        {/* Footer — shown on print */}
        <footer className="mt-8 pt-6 border-t border-surface text-xs text-fg-muted">
          <p>
            Prepared by CORE &middot; {currentMonth} &middot; For {report.firstName}&apos;s family
          </p>
        </footer>
      </div>
    </>
  );
}
