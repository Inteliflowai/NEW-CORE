'use client';
// src/app/(student)/student/assignments/[id]/_components/SparkLaunchCard.tsx
// Four-audience: student sees ONLY soft status text + a launch button.
// NO transfer scores, rubric dims, mastery enums, CL verbs, or risk numbers ever rendered here.
import { useState } from 'react';

const STATUS_TEXT: Record<string, string> = {
  none: '',
  notified: 'Your Spark Challenge is getting ready…',
  created: 'Your Spark Challenge is ready.',
  in_progress: 'You started this challenge — pick up where you left off.',
  completed: 'Challenge complete. Nice work!',
};

export function SparkLaunchCard({
  assignmentId,
  sparkStatus,
}: {
  assignmentId: string;
  sparkStatus: string;
}) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const completed = sparkStatus === 'completed';

  return (
    <div className="flex flex-col gap-3 rounded border border-surface bg-surface p-5">
      <span className="text-fg font-display text-lg font-semibold">Spark Challenge</span>
      <span className="text-fg text-sm">
        {STATUS_TEXT[sparkStatus] ?? 'Your Spark Challenge is ready.'}
      </span>
      {!completed && (
        <button
          type="button"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            setErr('');
            try {
              const res = await fetch('/api/attempts/spark-launch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignment_id: assignmentId }),
              });
              const json = (await res.json()) as { launch_url?: string; error?: string };
              if (res.ok && json.launch_url) {
                window.open(json.launch_url, '_blank');
              } else {
                setErr(json.error ?? 'Could not open the challenge.');
              }
            } catch {
              setErr('Could not open the challenge.');
            } finally {
              setWorking(false);
            }
          }}
          className="self-start rounded-lg border border-surface bg-brand px-4 py-2 text-sm font-bold text-fg-on-brand disabled:opacity-60"
        >
          {working ? 'Opening…' : 'Launch Challenge'}
        </button>
      )}
      {err && <span className="text-risk-fg text-xs">{err}</span>}
    </div>
  );
}
