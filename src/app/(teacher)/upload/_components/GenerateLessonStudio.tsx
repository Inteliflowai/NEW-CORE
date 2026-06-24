'use client';

/**
 * GenerateLessonStudio — the "Generate with AI" tab. The teacher describes a lesson (or unit), picks
 * an optional state for standards suggestions, and we generate a full lesson to review/edit. On
 * success we hand off to LessonReviewEditor. Token-only; deep-ink; strings DRAFT → Barb.
 */
import React, { useState } from 'react';
import { US_STATES } from '@/lib/standards/frameworks';
import LessonReviewEditor, { type GeneratedDay } from './LessonReviewEditor';
import { SectionLabel } from '../../_components/SectionLabel';
import MicButton from '@/app/(student)/student/assignments/[id]/play/_components/MicButton';

export interface GenerateLessonStudioProps {
  classId: string;
  schoolState: string | null;
}

interface GenerateResult {
  chapter_title: string | null;
  framework: string;
  days: GeneratedDay[];
}

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const LABEL = 'font-display text-sm font-extrabold text-fg';

export function GenerateLessonStudio({ classId, schoolState }: GenerateLessonStudioProps): React.JSX.Element {
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [numDays, setNumDays] = useState(1);
  const [state, setState] = useState(schoolState ?? '');
  const [phase, setPhase] = useState<'form' | 'generating' | 'error'>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  if (result) {
    return <LessonReviewEditor days={result.days} chapterTitle={result.chapter_title} framework={result.framework} classId={classId} />;
  }

  async function onGenerate() {
    if (!description.trim() || phase === 'generating') return;
    setPhase('generating'); setError(null);
    try {
      const res = await fetch('/api/teacher/lessons/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(), class_id: classId,
          subject: subject || undefined, grade_level: grade || undefined,
          num_days: numDays, state: state || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        setError(body?.error?.userMessage ?? "That didn't work — give it another try in a moment.");
        setPhase('error');
        return;
      }
      setResult((await res.json()) as GenerateResult);
    } catch {
      setError("That didn't work — give it another try in a moment.");
      setPhase('error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>What should this lesson teach?</span>
          <MicButton label="Dictate" onTranscript={(t) => setDescription((p) => (p.trim() ? `${p.trim()} ${t}` : t))} />
        </div>
        <textarea
          aria-label="Describe what to teach"
          className={`${INPUT} min-h-32`} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. A 7th-grade intro to photosynthesis: inputs, outputs, and why it matters."
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Subject <span className="font-normal text-fg-muted">(optional)</span></span>
          <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Grade <span className="font-normal text-fg-muted">(optional)</span></span>
          <input className={INPUT} value={grade} onChange={(e) => setGrade(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Days</span>
          <input
            type="number" min={1} max={10} className={`${INPUT} w-24`} value={numDays}
            onChange={(e) => setNumDays(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>State <span className="font-normal text-fg-muted">(optional — suggests standards)</span></span>
          <select className={INPUT} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">No state</option>
            {US_STATES.map((s) => (<option key={s.code} value={s.code}>{s.name}</option>))}
          </select>
        </label>
      </div>

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}
      {phase === 'generating' && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
          <SectionLabel tone="brand">Working</SectionLabel>
          <span className="text-fg text-sm">{numDays > 1 ? 'Writing your unit…' : 'Writing your lesson…'}</span>
        </div>
      )}

      <div>
        <button
          type="button" onClick={onGenerate} disabled={!description.trim() || phase === 'generating'}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          Generate
        </button>
      </div>
    </div>
  );
}

export default GenerateLessonStudio;
