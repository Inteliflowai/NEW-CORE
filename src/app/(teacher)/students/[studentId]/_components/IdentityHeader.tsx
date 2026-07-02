'use client';
// src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx
// TEACHER-ONLY. Full-width identity header: breadcrumb, avatar, name, grade, and
// action buttons. High Five is wired via QuickHighFiveModal; Add note is wired
// via AddNoteModal; Open Assignments links to the Gradebook.
// Tokens only.
import React, { useState } from 'react';
import Link from 'next/link';
import { QuickHighFiveModal } from './QuickHighFiveModal';
import { AddNoteModal } from './AddNoteModal';

interface IdentityHeaderProps {
  fullName: string;
  gradeLevel: string | null;
  classLabel: string | null;
  backHref: string;
  backLabel: string;
  studentId: string;
  classId: string | null;
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
  studentId,
  classId,
}: IdentityHeaderProps): React.JSX.Element {
  const [hfOpen, setHfOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const sub = [gradeLevel ? `Grade ${gradeLevel}` : null, classLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHfOpen(true)}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-sm font-bold text-fg shadow-sticker hover:bg-brand hover:text-fg-on-brand transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              High Five
            </button>
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-sm font-bold text-fg shadow-sticker hover:bg-brand hover:text-fg-on-brand transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Add note
            </button>
            <Link
              href={classId ? `/gradebook?class=${classId}` : '/gradebook'}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-sm font-bold text-fg shadow-sticker hover:bg-brand hover:text-fg-on-brand transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Open Assignments ›
            </Link>
          </div>
        </div>
      </div>

      <QuickHighFiveModal
        studentId={studentId}
        classId={classId}
        studentName={fullName}
        isOpen={hfOpen}
        onClose={() => setHfOpen(false)}
      />

      <AddNoteModal
        studentId={studentId}
        classId={classId}
        studentName={fullName}
        isOpen={noteOpen}
        onClose={() => setNoteOpen(false)}
      />
    </>
  );
}

export default IdentityHeader;
