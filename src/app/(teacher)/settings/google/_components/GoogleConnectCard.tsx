'use client';
// GoogleConnectCard — teacher Google Classroom connect/reconnect/disconnect status card.
// Reads /scope-check on mount; token-only; deep-ink. Strings DRAFT → Barb.
import React, { useEffect, useState } from 'react';

type Status = { connected: boolean; needsReconnect: boolean; missing: string[] } | null;

export default function GoogleConnectCard(): React.JSX.Element {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/teacher/google/scope-check')
      .then((r) => r.json())
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus({ connected: false, needsReconnect: false, missing: [] }); });
    return () => { alive = false; };
  }, []);

  async function disconnect() {
    setBusy(true);
    try { await fetch('/api/teacher/google/disconnect', { method: 'POST' }); setStatus({ connected: false, needsReconnect: false, missing: [] }); }
    finally { setBusy(false); }
  }

  const linkCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
  const btnCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker">
      <h2 className="font-display text-lg font-extrabold text-fg">Google Classroom</h2>
      {status === null ? (
        <p role="status" className="text-fg text-sm">Checking your connection…</p>
      ) : status.needsReconnect ? (
        <>
          <p role="status" className="text-fg text-sm">Your Google access needs renewing.</p>
          <a href="/api/teacher/google/connect" className={linkCls}>Reconnect Google Classroom</a>
        </>
      ) : status.connected ? (
        <>
          <p role="status" className="text-fg text-sm">Connected.</p>
          <button type="button" onClick={disconnect} disabled={busy} className={btnCls}>Disconnect</button>
        </>
      ) : (
        <>
          <p role="status" className="text-fg text-sm">Connect your Google account to import rosters and sync assignments.</p>
          <a href="/api/teacher/google/connect" className={linkCls}>Connect Google Classroom</a>
        </>
      )}
    </div>
  );
}
