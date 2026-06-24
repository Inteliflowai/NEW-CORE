'use client';
// GoogleConnectCard — teacher Google Classroom connect/reconnect/disconnect status card.
// Reads /scope-check on mount; token-only; deep-ink. Strings DRAFT → Barb.
import React, { useEffect, useState } from 'react';

type Status = { connected: boolean; needsReconnect: boolean; missing: string[] } | null;

function bannerTextForError(code: string | null): string | null {
  if (!code) return null;
  if (code === 'denied') return "You cancelled before finishing — try again.";
  if (code === 'unverified') return "That Google account's email isn't verified — connect a verified Google account.";
  return "Couldn't finish connecting — please try again.";
}

interface GoogleConnectCardProps {
  initialError?: string | null;
  justConnected?: boolean;
}

export default function GoogleConnectCard({ initialError, justConnected }: GoogleConnectCardProps = {}): React.JSX.Element {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/teacher/google/scope-check')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('scope-check ' + r.status))))
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, []);

  async function disconnect() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/teacher/google/disconnect', { method: 'POST' });
      if (res.ok) { setStatus({ connected: false, needsReconnect: false, missing: [] }); }
      else { setError("That didn't disconnect — try again in a moment."); }
    } catch { setError("That didn't disconnect — try again in a moment."); }
    finally { setBusy(false); }
  }

  const linkCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
  const btnCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';

  const bannerText = bannerTextForError(initialError ?? null);

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker">
      <h2 className="font-display text-lg font-extrabold text-fg">Google Classroom</h2>
      {bannerText && (
        <p role="alert" className="text-fg text-sm">{bannerText}</p>
      )}
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
          {error && <p role="alert" className="text-fg text-sm">{error}</p>}
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
