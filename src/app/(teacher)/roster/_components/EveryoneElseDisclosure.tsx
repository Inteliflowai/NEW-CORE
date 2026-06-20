'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { RosterItem } from '@/lib/signals/loadRosterSignals';
import { MasteryLabel } from '@/components/core/MasteryLabel';
import { RiskBadge } from '@/components/core/RiskBadge';

export function EveryoneElseDisclosure({
  others,
  classId,
}: {
  others: RosterItem[];
  classId: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-[13px] font-bold text-fg shadow-sticker transition-colors hover:bg-brand hover:text-fg-on-brand"
      >
        Everyone else ({others.length}) {open ? '▴' : '▾'}
      </button>

      {open && (
        <ul className="mt-2 divide-y divide-fg-muted/15 overflow-hidden rounded-lg border-2 border-sidebar-edge bg-surface">
          {others.map((r) => (
            <li key={r.student_id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
              <span className="text-fg font-semibold">{r.full_name}</span>
              <MasteryLabel band={r.band} />
              {r.risk.risk_level !== 'low' && (
                <RiskBadge band={r.risk.risk_level as 'medium' | 'high' | 'critical'} />
              )}
              <Link
                href={`/students/${r.student_id}?from=roster&class=${classId}`}
                className="ml-auto inline-flex items-center rounded border-2 border-sidebar-edge bg-brand-surface px-2 py-0.5 text-xs font-bold text-brand-fg"
              >
                Look closer ›
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default EveryoneElseDisclosure;
