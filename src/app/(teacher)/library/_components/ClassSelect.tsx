'use client';

/**
 * ClassSelect — the library filter-bar Class picker. It IS the sidebar's active class, surfaced
 * where the teacher is working: changing it navigates `?class=<id>` (server reload), which keeps
 * the sidebar's "Active class" in sync (both read the same `?class=` param). "One class at a time"
 * (Marvin, 2026-06-23): no cross-class view. Rendered ONLY when the teacher has more than one class.
 *
 * Token-only Tailwind v4; pop-art chrome (border-2 + shadow-sticker). String "Class" → Barb.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import type { LibraryClassOption } from '@/lib/teacher/teacherClasses';

export interface ClassSelectProps {
  classes: LibraryClassOption[];
  currentClassId: string;
  /** Route the select navigates to, e.g. "/library/lessons". */
  basePath: string;
}

export function ClassSelect({ classes, currentClassId, basePath }: ClassSelectProps): React.JSX.Element | null {
  const router = useRouter();
  if (classes.length <= 1) return null;

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`${basePath}?class=${encodeURIComponent(e.target.value)}`);
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-muted">Class</span>
      <select
        aria-label="Class"
        value={currentClassId}
        onChange={onChange}
        className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-fg text-sm shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {classes.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}

export default ClassSelect;
