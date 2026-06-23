'use client';

/**
 * LessonViewPanel — a read-only side panel showing the actual lesson plan a teacher uploaded:
 * the parsed objectives, key concepts, vocabulary, likely misconceptions, and summary
 * (lessons.parsed_content). Mirrors the Quiz Library's QuizEditPanel chrome exactly — right-side
 * role="dialog" with focus trapping, Escape-to-close, click-scrim-to-close, and focus restoration
 * to the originating row.
 *
 * TEACHER-ONLY surface, so "likely misconceptions" (a teacher-only diagnostic lens) is appropriate
 * here; there is no band enum / risk number / signals anywhere. Token-only Tailwind v4; deep-ink
 * text. All user-facing strings are DRAFTS → Barb (STRINGS-FOR-BARB.md §Content Studio).
 */

import React, { useEffect, useRef } from 'react';
import type { LessonLibRow } from '@/lib/lessons/loadLessonLibrary';
import { SectionLabel } from '../../../_components/SectionLabel';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function statusWord(status: string): string {
  if (status === 'published') return 'Published';
  if (status === 'pending_review') return 'Ready to review';
  return 'Draft';
}

/** A titled section that renders only when it has content. */
function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 border-t-2 border-sidebar-edge pt-4">
      <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-fg">{title}</h3>
      {children}
    </section>
  );
}

export interface LessonViewPanelProps {
  lesson: LessonLibRow;
  onClose: () => void;
}

export function LessonViewPanel({ lesson, onClose }: LessonViewPanelProps): React.JSX.Element {
  const plan = lesson.parsed_content;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => { triggerRef.current?.focus?.(); };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  }

  const meta = [lesson.subject, lesson.grade_level ? `Grade ${lesson.grade_level}` : null].filter(Boolean).join(' · ');

  const objectives = plan?.objectives ?? [];
  const concepts = plan?.key_concepts ?? [];
  const vocab = plan?.vocabulary ?? [];
  const misconceptions = plan?.misconception_risks ?? [];
  const summary = plan?.summary?.trim() ?? '';
  // ParsedLessonSchema defaults every field, so a valid-but-empty object ({}) parses non-null;
  // treat "no displayable content" the same as "no plan" so we never show an empty-bodied dialog.
  const hasPlan =
    plan != null &&
    (summary.length > 0 || objectives.length > 0 || concepts.length > 0 || vocab.length > 0 || misconceptions.length > 0);

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-fg/30" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Lesson plan — ${lesson.title}`}
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-30 flex w-full max-w-lg flex-col gap-4 overflow-y-auto border-l-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-extrabold text-fg">{lesson.title}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel tone={lesson.status === 'published' ? 'ok' : 'brand'}>{statusWord(lesson.status)}</SectionLabel>
              {meta && <span className="text-fg text-xs">{meta}</span>}
            </div>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ✕
          </button>
        </div>

        {!hasPlan && (
          <p className="text-sm text-fg">
            There&rsquo;s no lesson plan to show for this lesson yet. Once it&rsquo;s processed, the
            objectives and key ideas appear here.
          </p>
        )}

        {hasPlan && summary && (
          <Section title="Summary">
            <p className="text-fg text-sm leading-relaxed">{summary}</p>
          </Section>
        )}

        {hasPlan && objectives.length > 0 && (
          <Section title="Learning goals">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-fg text-sm">
              {objectives.map((o, i) => (<li key={i}>{o}</li>))}
            </ul>
          </Section>
        )}

        {hasPlan && concepts.length > 0 && (
          <Section title="Key ideas">
            <ul className="flex flex-wrap gap-2">
              {concepts.map((c, i) => (
                <li key={i} className="rounded-md border-2 border-sidebar-edge bg-bg px-2 py-0.5 text-fg text-xs font-bold">{c}</li>
              ))}
            </ul>
          </Section>
        )}

        {hasPlan && vocab.length > 0 && (
          <Section title="Vocabulary">
            <dl className="flex flex-col gap-2">
              {vocab.map((v, i) => (
                <div key={i} className="flex flex-col">
                  <dt className="text-fg text-sm font-bold">{v.term}</dt>
                  <dd className="text-fg text-sm">{v.definition}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {hasPlan && misconceptions.length > 0 && (
          <Section title="Watch for these mix-ups">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-fg text-sm">
              {misconceptions.map((m, i) => (<li key={i}>{m}</li>))}
            </ul>
          </Section>
        )}
      </aside>
    </>
  );
}

export default LessonViewPanel;
