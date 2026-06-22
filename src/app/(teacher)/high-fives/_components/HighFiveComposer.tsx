'use client';
import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import type { HighFiveSuggestion } from '@/lib/highfives/suggestions';

interface Violation { phrase: string; suggestion: string }
export interface RosterStudent { student_id: string; full_name: string }
export interface RecentHighFive { student_id: string; full_name: string; note_text: string; created_at: string }

// What the composer needs to address ONE student — a suggestion carries a reason
// hint; a hand-picked roster student opens a blank composer (reason_hint = null).
interface ActiveTarget { student_id: string; full_name: string; reason: string | null; context_hint: string | null }

export function HighFiveComposer({
  classId,
  suggestions,
  roster,
  recent,
}: {
  classId: string;
  suggestions: HighFiveSuggestion[];
  roster: RosterStudent[];
  recent: RecentHighFive[];
}): React.JSX.Element {
  const router = useRouter();
  const [active, setActive] = useState<ActiveTarget | null>(null);
  const [pickedId, setPickedId] = useState('');
  const [text, setText] = useState('');
  const [aiDrafted, setAiDrafted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const violationsRef = useRef<HTMLDivElement>(null);

  function open(t: ActiveTarget) { setActive(t); setText(''); setViolations([]); setErr(null); setAiDrafted(false); }

  function openPicked() {
    const s = roster.find((r) => r.student_id === pickedId);
    if (!s) return;
    open({ student_id: s.student_id, full_name: s.full_name, reason: null, context_hint: null });
  }

  async function draft() {
    if (!active) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/teacher/high-fives/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: active.student_id, class_id: classId, reason_hint: active.reason, context_hint: active.context_hint }),
      });
      const data = await res.json();
      if (res.ok && data.draft_text) { setText(data.draft_text); setAiDrafted(true); }
      else setErr('Could not draft — write your own below.');
    } catch { setErr('Could not draft — write your own below.'); }
    setBusy(false);
  }

  async function send() {
    if (!active || text.trim().length === 0) return;
    setBusy(true); setViolations([]); setErr(null);
    try {
      const res = await fetch('/api/teacher/high-fives/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: active.student_id, class_id: classId, text, reason_hint: active.reason, ai_drafted: aiDrafted }),
      });
      if (res.status === 422) {
        const d = await res.json();
        setViolations(d.violations ?? []);
        setBusy(false);
        // Move focus to the violations so a screen reader lands on the feedback.
        requestAnimationFrame(() => violationsRef.current?.focus());
        return;
      }
      if (!res.ok) { setErr('Could not send — try again.'); setBusy(false); return; }
      setActive(null); setText(''); router.refresh();
    } catch { setErr('Could not send — try again.'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel tone="lime">Worth recognizing today</SectionLabel>
      {suggestions.length === 0 && (
        <p className="text-fg text-sm">No standouts to flag today — you can still write a note to anyone from the roster.</p>
      )}
      <div className="flex flex-col gap-3">
        {suggestions.map((s) => (
          <Card key={s.student_id} tone="surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-fg font-display font-bold">{s.full_name}</span>
                <span className="text-fg text-sm">{s.context_hint}</span>
              </div>
              <button type="button" onClick={() => open({ student_id: s.student_id, full_name: s.full_name, reason: s.reason, context_hint: s.context_hint })}
                className="rounded-md border-2 border-sidebar-edge bg-brand-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Write a note
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Pick anyone from the roster — works even when there are no suggestions. */}
      {roster.length > 0 && (
        <Card tone="surface">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-bold text-fg" htmlFor="hf-picker">
              Write a note to someone else
              <select id="hf-picker" value={pickedId} onChange={(e) => setPickedId(e.target.value)}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                <option value="">Choose a student…</option>
                {roster.map((r) => <option key={r.student_id} value={r.student_id}>{r.full_name}</option>)}
              </select>
            </label>
            <button type="button" onClick={openPicked} disabled={pickedId === ''}
              className="rounded-md border-2 border-sidebar-edge bg-brand-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              Open note
            </button>
          </div>
        </Card>
      )}

      {active && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg font-display font-bold">A note for {active.full_name}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={draft} disabled={busy}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                {busy ? 'Working…' : 'Draft with help'}
              </button>
            </div>
            <label className="sr-only" htmlFor="hf-text">Note text</label>
            <textarea id="hf-text" value={text} onChange={(e) => { setText(e.target.value); setAiDrafted(false); }}
              maxLength={600} rows={3}
              aria-invalid={violations.length > 0}
              aria-describedby={violations.length > 0 ? 'hf-violations' : undefined}
              className="w-full rounded-md border-2 border-sidebar-edge bg-surface p-2 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" />
            {violations.length > 0 && (
              <div ref={violationsRef} id="hf-violations" role="alert" aria-live="assertive" tabIndex={-1}
                className="rounded border-2 border-sidebar-edge bg-risk-surface p-2 text-fg">
                <p className="text-sm font-bold">⚠ Let&apos;s reword this</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {violations.map((v, i) => <li key={i} className="text-fg text-sm">Avoid &quot;{v.phrase}&quot; — {v.suggestion}</li>)}
                </ul>
              </div>
            )}
            {err && <p className="text-fg text-sm">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={send} disabled={busy || text.trim().length === 0}
                className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-1 text-sm font-bold text-fg-on-brand shadow-sticker disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Send
              </button>
              <button type="button" onClick={() => setActive(null)}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}

      {recent.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel tone="brand">Recent</SectionLabel>
          <div className="flex flex-col gap-2">
            {recent.map((r, i) => (
              <Card key={`${r.student_id}-${i}`} tone="surface">
                <div className="flex flex-col gap-0.5">
                  <span className="text-fg font-display font-bold">{r.full_name}</span>
                  <span className="text-fg text-sm">{r.note_text}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export default HighFiveComposer;
