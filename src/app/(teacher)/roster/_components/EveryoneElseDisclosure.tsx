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
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="text-sm text-fg hover:text-brand transition-colors"
      >
        Everyone else ({others.length}) ▾
      </button>

      {open && (
        <ul className="mt-2 space-y-1">
          {others.map((r) => (
            <li key={r.student_id} className="flex items-center gap-2 text-sm">
              <span className="text-fg font-medium">{r.full_name}</span>
              <MasteryLabel band={r.band} />
              {r.risk.risk_level !== 'low' && (
                <RiskBadge band={r.risk.risk_level as 'medium' | 'high' | 'critical'} />
              )}
              <Link
                href={`/students/${r.student_id}?from=roster&class=${classId}`}
                className="ml-auto text-fg hover:text-brand"
              >
                look closer ›
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default EveryoneElseDisclosure;
