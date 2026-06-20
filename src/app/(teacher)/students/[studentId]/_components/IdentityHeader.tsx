// src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx
// TEACHER-ONLY. Full-width identity header: breadcrumb back, avatar (initials),
// real full_name, "Grade {grade_level} · {class label}", and the three action
// buttons (High Five / Add note / Open Assignments).
//
// Writes are DEFERRED: High Five / Add note / Open Assignments are rendered
// disabled-looking (no-op) — there is no teacher assignments route yet, so a live
// link would 404. Tokens only.

import React from 'react';
import Link from 'next/link';

interface IdentityHeaderProps {
  fullName: string;
  gradeLevel: string | null;
  classLabel: string | null;
  backHref: string;
  backLabel: string;
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
}: IdentityHeaderProps): React.JSX.Element {
  const sub = [gradeLevel ? `Grade ${gradeLevel}` : null, classLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumb back — pop pill */}
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 self-start rounded-md border-2 border-sidebar-edge bg-surface px-2.5 py-1 text-xs font-bold text-fg shadow-sticker transition-colors hover:bg-brand hover:text-fg-on-brand"
      >
        ← {backLabel}
      </Link>

      <div className="flex items-center gap-3">
        {/* Avatar — bold cobalt sticker tile */}
        <div
          className="grid size-14 shrink-0 -rotate-3 place-items-center rounded-xl border-2 border-sidebar-edge bg-brand font-display text-lg font-extrabold text-fg-on-brand shadow-sticker"
          aria-hidden="true"
        >
          {initialsOf(fullName)}
        </div>

        <div className="flex-1">
          <h1 className="font-display text-xl text-fg font-bold tracking-tight">{fullName}</h1>
          {sub && <p className="text-fg-muted text-sm">{sub}</p>}
        </div>

        {/* Actions — all DEFERRED (no-op, disabled-looking). The teacher
            assignments view isn't built yet, so "Open Assignments" is disabled
            rather than a dead link that 404s. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm font-bold text-fg-muted opacity-50"
          >
            High Five
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm font-bold text-fg-muted opacity-50"
          >
            Add note
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm font-bold text-fg-muted opacity-50"
          >
            Open Assignments ›
          </button>
        </div>
      </div>
    </div>
  );
}

export default IdentityHeader;
