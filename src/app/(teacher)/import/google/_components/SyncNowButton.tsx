'use client';
// "Sync now" — re-runs the two-way reconcile for an already-imported GC class. Strings DRAFT → Barb.
import React, { useState } from 'react';

type Result = { created: number; linked: number; skippedNoEmail: number; reactivated: number; softRemoved: number } | null;

export default function SyncNowButton({ classId }: { classId: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  async function sync() {
    setBusy(true);
    try {
      const res = await fetch('/api/teacher/google/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classId }) });
      setResult(await res.json());
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={sync} disabled={busy} className="inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {result && (
        // DRAFT copy → Barb. Coach-posture: a roster change is an OBSERVATION, not an alarm — phrase
        // the soft-un-enroll as "no longer in this class", never "removed" (ITEM C / MIN-7).
        <p role="status" className="text-fg text-sm">
          {result.linked} kept · {result.created} new · {result.reactivated} re-added · {result.softRemoved} no longer in this class
        </p>
      )}
    </div>
  );
}
