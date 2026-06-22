'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';
import { alertTriggerLabel, severityTone, type AlertSeverity, type AlertSourceKind } from '@/lib/copy/alertTriggerLabel';

export interface AlertRowItem { id: string; student_id: string; student_name: string; source_kind: AlertSourceKind; severity: AlertSeverity; created_at: string }

export function AlertRow({ alert, classId, onResolved }: { alert: AlertRowItem; classId: string; onResolved: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function markHandled() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/teacher/alerts/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alert_id: alert.id }),
      });
      if (!res.ok) { setErr('Could not mark handled — try again.'); setBusy(false); return; }
      onResolved();
    } catch { setErr('Could not mark handled — try again.'); setBusy(false); }
  }

  return (
    <Card tone={severityTone(alert.severity)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Link href={`/students/${alert.student_id}?class=${classId}`} className="text-fg font-display font-bold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            {alert.student_name}
          </Link>
          <span className="text-fg text-sm">{alertTriggerLabel(alert.source_kind)}</span>
        </div>
        <button type="button" onClick={markHandled} disabled={busy}
          className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker transition-colors hover:bg-brand-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          {busy ? 'Working…' : 'Mark handled'}
        </button>
      </div>
      {err && <p className="text-fg mt-2 text-sm">{err}</p>}
    </Card>
  );
}
export default AlertRow;
