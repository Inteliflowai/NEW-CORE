'use client';

/**
 * LessonReviewEditor — review/edit AI-generated lesson(s), confirm the AI-proposed standards,
 * then make a quiz per day. Forked from the read-only LessonViewPanel; here every field is editable.
 * Arrays edit as newline textareas (vocabulary as "term: definition" per line). Multi-day units get
 * a day pager. "Save unit & make quizzes" loops each day: /lessons/manage (edit) then /quizzes/generate.
 *
 * Teacher-only surface. Token-only Tailwind v4; deep-ink text; pop-art chrome. "Assignments", never
 * "Homework". All strings DRAFT → Barb (STRINGS-FOR-BARB.md §Content Studio).
 */
import React, { useState } from 'react';
import Link from 'next/link';
import type { GeneratedLesson, ProposedStandard } from '@/lib/engine/types';
import { SectionLabel } from '../../_components/SectionLabel';

export interface GeneratedDay {
  lesson_id: string;
  day_index: number | null;
  title: string;
  subject: string | null;
  grade_level: string | null;
  parsed_content: GeneratedLesson;
  standard_framework: string;
}
export interface LessonReviewEditorProps {
  days: GeneratedDay[];
  chapterTitle: string | null;
  framework: string;
  classId: string;
}

interface DayDraft {
  lesson_id: string;
  day_index: number | null;
  title: string;
  subject: string;
  grade_level: string;
  summary: string;
  objectives: string;
  concepts: string;
  vocab: string;
  misconceptions: string;
  proposed: ProposedStandard[];
  checked: Record<string, boolean>;
}

const linesToArray = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);
const arrayToLines = (a: string[] | undefined): string => (a ?? []).join('\n');
const vocabToLines = (v: { term: string; definition: string }[] | undefined): string =>
  (v ?? []).map((x) => `${x.term}: ${x.definition}`).join('\n');
const linesToVocab = (s: string): { term: string; definition: string }[] =>
  linesToArray(s).map((line) => {
    const i = line.indexOf(':');
    return i === -1 ? { term: line, definition: '' } : { term: line.slice(0, i).trim(), definition: line.slice(i + 1).trim() };
  });

function toDraft(d: GeneratedDay): DayDraft {
  const p = d.parsed_content;
  return {
    lesson_id: d.lesson_id, day_index: d.day_index,
    title: d.title ?? p.title ?? '', subject: d.subject ?? p.subject ?? '', grade_level: d.grade_level ?? p.grade_level ?? '',
    summary: p.summary ?? '', objectives: arrayToLines(p.objectives), concepts: arrayToLines(p.key_concepts),
    vocab: vocabToLines(p.vocabulary), misconceptions: arrayToLines(p.misconception_risks),
    proposed: p.proposed_standards ?? [],
    // AI-proposed standards default to CHECKED (opt-out confirm) — the teacher unchecks to drop one.
    checked: Object.fromEntries((p.proposed_standards ?? []).map((s) => [s.code, true])),
  };
}

function draftToParsedContent(d: DayDraft): GeneratedLesson {
  return {
    title: d.title, summary: d.summary, objectives: linesToArray(d.objectives),
    key_concepts: linesToArray(d.concepts), vocabulary: linesToVocab(d.vocab),
    misconception_risks: linesToArray(d.misconceptions),
    grade_level: d.grade_level || undefined, subject: d.subject || undefined,
    proposed_standards: d.proposed,
  };
}

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const LABEL = 'font-display text-sm font-extrabold text-fg';

export function LessonReviewEditor({ days, chapterTitle, framework, classId }: LessonReviewEditorProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<DayDraft[]>(() => days.map(toDraft));
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<'edit' | 'saving' | 'done' | 'error'>('edit');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const multi = drafts.length > 1;
  const d = drafts[active];
  const lessonsHref = `/library/lessons?class=${encodeURIComponent(classId)}`;
  const quizzesHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;

  function patch(p: Partial<DayDraft>) {
    setDrafts((prev) => prev.map((x, i) => (i === active ? { ...x, ...p } : x)));
  }
  function toggleStandard(code: string) {
    setDrafts((prev) => prev.map((x, i) => (i === active ? { ...x, checked: { ...x.checked, [code]: !x.checked[code] } } : x)));
  }

  async function saveAll() {
    setPhase('saving'); setError(null);
    try {
      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        setProgress(multi ? `Saving day ${i + 1} of ${drafts.length}…` : 'Saving your lesson…');
        const codes = draft.proposed.map((s) => s.code).filter((c) => draft.checked[c]);
        const editRes = await fetch('/api/teacher/lessons/manage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lesson_id: draft.lesson_id, action: 'edit',
            title: draft.title, subject: draft.subject || null, grade_level: draft.grade_level || null,
            parsed_content: draftToParsedContent(draft), standard_codes: codes, standard_framework: framework,
          }),
        });
        if (!editRes.ok) throw new Error('save');
        setProgress(multi ? `Building quiz ${i + 1} of ${drafts.length}…` : 'Building a quiz…');
        const genRes = await fetch('/api/teacher/quizzes/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lesson_id: draft.lesson_id }),
        });
        if (!genRes.ok) throw new Error('quiz');
      }
      setPhase('done');
    } catch {
      setError("That didn't finish — give it another try in a moment.");
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <div data-testid="generate-done" className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-ok-surface p-5 shadow-sticker">
        <SectionLabel tone="ok">{multi ? 'Unit ready' : 'Quiz ready'}</SectionLabel>
        <p className="font-display text-base font-bold text-fg">
          {multi ? `${drafts.length} lessons saved, each with a quiz drafted.` : 'Lesson saved and a quiz is drafted.'}
        </p>
        <p className="text-fg text-sm">Review and publish each quiz when it&apos;s ready for students.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={quizzesHref} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">
            Open the Quiz Library
          </Link>
          <Link href={lessonsHref} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">
            Back to the Lesson Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {chapterTitle && (
        <div className="flex flex-col gap-1">
          <SectionLabel tone="brand">Unit</SectionLabel>
          <p className="font-display text-base font-bold text-fg">{chapterTitle}</p>
        </div>
      )}

      {multi && (
        <div role="group" aria-label="Days in this unit" className="flex flex-wrap gap-2">
          {drafts.map((dr, i) => (
            <button
              key={dr.lesson_id} type="button" aria-pressed={i === active}
              onClick={() => setActive(i)}
              className={[
                'rounded-md border-2 border-sidebar-edge px-3 py-1 font-display text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                i === active ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg',
              ].join(' ')}
            >
              Day {dr.day_index ?? i + 1}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Title</span>
        <input className={INPUT} value={d.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Subject</span>
          <input className={INPUT} value={d.subject} onChange={(e) => patch({ subject: e.target.value })} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Grade</span>
          <input className={INPUT} value={d.grade_level} onChange={(e) => patch({ grade_level: e.target.value })} />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Lesson passage</span>
        <textarea className={`${INPUT} min-h-40`} value={d.summary} onChange={(e) => patch({ summary: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Learning goals <span className="font-normal text-fg-muted">(one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.objectives} onChange={(e) => patch({ objectives: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Key ideas <span className="font-normal text-fg-muted">(one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.concepts} onChange={(e) => patch({ concepts: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Vocabulary <span className="font-normal text-fg-muted">(term: definition, one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.vocab} onChange={(e) => patch({ vocab: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Watch for these mix-ups <span className="font-normal text-fg-muted">(one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.misconceptions} onChange={(e) => patch({ misconceptions: e.target.value })} />
      </label>

      <fieldset className="flex flex-col gap-2 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
        <legend className={LABEL}>Standards <span className="font-normal text-fg-muted">· {framework}</span></legend>
        {d.proposed.length === 0 && <p className="text-fg text-sm">No standards were proposed for this lesson. You can publish without them.</p>}
        {d.proposed.map((s) => (
          <label key={s.code} className="flex items-start gap-2 text-fg text-sm">
            <input type="checkbox" checked={!!d.checked[s.code]} onChange={() => toggleStandard(s.code)} className="mt-1" />
            <span><span className="font-bold">{s.code}</span> — {s.description}</span>
          </label>
        ))}
      </fieldset>

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}
      {phase === 'saving' && (
        <p role="status" aria-live="polite" className="rounded-lg border-2 border-sidebar-edge bg-surface p-4 text-fg text-sm shadow-sticker">{progress}</p>
      )}

      <div>
        <button
          type="button" onClick={saveAll} disabled={phase === 'saving'}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          {multi ? 'Save unit & make quizzes' : 'Save & make quiz'}
        </button>
      </div>
    </div>
  );
}

export default LessonReviewEditor;
