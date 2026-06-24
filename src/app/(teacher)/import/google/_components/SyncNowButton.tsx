'use client';
// "Sync now" — re-runs the two-way reconcile for an already-imported GC class. Strings DRAFT → Barb.
import React, { useState } from 'react';

// MIN-2: discriminated union so the compiler forces IMP-3 branching on all envelope shapes.
// ITEM C (intentional pilot scope): only the summary counts are surfaced; other skip buckets and
// the errors count are coach-posture noise — revisit with Barb before expanding.
type SyncResponse =
  | { connected: false; needsReconnect?: boolean; error?: string }   // auth/reconnect envelope
  | { error: string; connected?: never }                              // 500 error envelope
  | { created: number; linked: number; skippedNoEmail: number; reactivated: number; softRemoved: number };   // real result

type RealResult = Extract<SyncResponse, { created: number }>;

export default function SyncNowButton({ classId }: { classId: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RealResult | null>(null);
  const [syncHint, setSyncHint] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setSyncHint(null);
    setResult(null);
    try {
      const res = await fetch('/api/teacher/google/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classId }) });
      const d: SyncResponse = await res.json();
      // IMP-3: branch before rendering. Auth/reconnect → show reconnect hint. Error or non-numeric
      // counts → show a brief error. Only a real result renders the summary line.
      // Cast through unknown so the discriminated-union narrowing works correctly.
      const resp = d as unknown as Record<string, unknown>;
      if (resp['connected'] === false || resp['needsReconnect'] === true) {
        setSyncHint('reconnect');
        return;
      }
      if (typeof resp['created'] !== 'number') {
        setSyncHint('error');
        return;
      }
      setResult(d as RealResult);
    } catch {
      setSyncHint('error');
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={sync} disabled={busy} className="inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {syncHint === 'reconnect' && (
        <p role="status" className="text-fg text-sm">
          Google Classroom needs to be reconnected. <a href="/settings/google" className="underline">Reconnect Google</a>
        </p>
      )}
      {syncHint === 'error' && (
        <p role="alert" className="text-fg text-sm">Sync failed — please try again.</p>
      )}
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
