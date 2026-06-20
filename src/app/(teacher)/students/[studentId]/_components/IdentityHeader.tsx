// src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx
// TEACHER-ONLY. Full-width identity header: breadcrumb back, avatar (initials),
// real full_name, "Grade {grade_level} · {class label}", and the three action
// buttons (High Five / Add note / Open Assignments).
//
// Writes are DEFERRED: High Five / Add note are rendered disabled-looking (no-op);
// Open Assignments is a plain link. Tokens only.

import React from 'react';
import Link from 'next/link';

interface IdentityHeaderProps {
  fullName: string;
  gradeLevel: string | null;
  classLabel: string | null;
  backHref: string;
  backLabel: string;
  assignmentsHref: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

export function IdentityHeader({
  fullName,
  gradeLevel,
  classLabel,
  backHref,
  backLabel,
  assignmentsHref,
}: IdentityHeaderProps): React.JSX.Element {
  const sub = [gradeLevel ? `Grade ${gradeLevel}` : null, classLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumb back */}
      <Link href={backHref} className="text-brand-fg text-sm underline self-start">
        ← {backLabel}
      </Link>

      <div className="flex items-center gap-4">
        {/* Avatar — initials */}
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-surface text-brand-fg font-display font-semibold"
          aria-hidden="true"
        >
          {initialsOf(fullName)}
        </div>

        <div className="flex-1">
          <h1 className="font-display text-2xl text-fg font-semibold">{fullName}</h1>
          {sub && <p className="text-fg-muted text-sm">{sub}</p>}
        </div>

        {/* Actions — High Five / Add note are DEFERRED (no-op, disabled-looking).
            Open Assignments is a plain link. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="rounded border border-fg-muted px-3 py-1.5 text-sm text-fg-muted opacity-60"
          >
            High Five
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="rounded border border-fg-muted px-3 py-1.5 text-sm text-fg-muted opacity-60"
          >
            Add note
          </button>
          <Link
            href={assignmentsHref}
            className="rounded border border-brand-fg px-3 py-1.5 text-sm text-brand-fg"
          >
            Open Assignments ›
          </Link>
        </div>
      </div>
    </div>
  );
}

export default IdentityHeader;
