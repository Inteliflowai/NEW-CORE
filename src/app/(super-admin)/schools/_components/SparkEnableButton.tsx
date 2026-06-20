'use client';
import { useState } from 'react';

export function SparkEnableButton({ schoolId, enabled }: { schoolId: string; enabled: boolean }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>(enabled ? 'done' : 'idle');
  const [msg, setMsg] = useState('');
  if (state === 'done') return <span className="text-ok-fg text-sm font-semibold">SPARK enabled</span>;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === 'working'}
        onClick={async () => {
          setState('working');
          try {
            const res = await fetch('/api/admin/spark-enable', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ school_id: schoolId }),
            });
            const json = await res.json() as { ok?: boolean; error?: string; steps?: Record<string, string> };
            if (res.ok && json.ok) {
              setState('done');
            } else {
              setState('error');
              setMsg(json.steps ? JSON.stringify(json.steps) : (json.error ?? 'failed'));
            }
          } catch (e) {
            setState('error');
            setMsg((e as Error).message);
          }
        }}
        className="rounded-lg border border-surface bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand disabled:opacity-60"
      >
        {state === 'working' ? 'Enabling…' : 'Enable SPARK'}
      </button>
      {state === 'error' && <span className="text-risk-fg text-xs">{msg}</span>}
    </div>
  );
}
