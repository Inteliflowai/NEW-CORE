'use client';

import React, { useId } from 'react';

// ── Shared types (exported for ChapterTestPlayer) ─────────────────────────────

/** Mutable student response — either free text or a structured payload. */
export type ResponseDraft = {
  response_text?: string;
  response_payload?: Record<string, unknown>;
};

/** Shape of a chapter-test question (mirrors the DB / API contract). */
export interface QuestionData {
  id: string;
  question_order: number;
  question_type: string;
  question_text: string;
  /** Type-specific configuration: choices, left/right items, mermaid diagram, etc. */
  payload: Record<string, unknown>;
  points: number;
}

// ── Internal payload shapes ───────────────────────────────────────────────────

interface McqChoice {
  label: string;
  text: string;
}

interface MatchingPair {
  left_idx: number;
  right_idx: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface QuestionRendererProps {
  question: QuestionData;
  response: ResponseDraft;
  onChange: (draft: ResponseDraft) => void;
}

/**
 * Renders a single chapter-test question and its interactive answer input.
 *
 * Dispatches to the appropriate input type based on `question.question_type`:
 * - `mcq`             → radio group (choices from payload.choices)
 * - `matching`        → select per left item (pairs stored in response_payload)
 * - `short_answer`, `compare_contrast`, `mini_essay`, `multi_step_problem`
 *                     → textarea (stored as response_text)
 * - `data_interpretation` → optional mermaid pre-block + textarea
 * - unknown           → textarea fallback
 */
export function QuestionRenderer({ question, response, onChange }: QuestionRendererProps) {
  const textId = useId();

  return (
    <div className="space-y-3">
      {/* Question stem — id is referenced by aria-labelledby on the input group */}
      <p id={textId} className="text-fg font-medium leading-snug">
        {question.question_text}
        <span className="ml-2 text-fg-muted text-sm font-normal">
          ({question.points} {question.points === 1 ? 'pt' : 'pts'})
        </span>
      </p>

      <QuestionInput
        question={question}
        response={response}
        onChange={onChange}
        textId={textId}
      />
    </div>
  );
}

// ── Per-type input sub-components ─────────────────────────────────────────────

interface InputProps extends QuestionRendererProps {
  textId: string;
}

function QuestionInput({ question, response, onChange, textId }: InputProps) {
  const { question_type, payload, id: qid } = question;

  // ── MCQ ────────────────────────────────────────────────────────────────────
  if (question_type === 'mcq') {
    const choices = (payload.choices as McqChoice[] | undefined) ?? [];
    const selectedLabel = response.response_payload?.selected_label as string | undefined;

    return (
      <div role="radiogroup" aria-labelledby={textId} className="space-y-2">
        {choices.map((choice) => (
          <label
            key={choice.label}
            className="flex items-start gap-3 cursor-pointer"
          >
            <input
              type="radio"
              name={`mcq-${qid}`}
              value={choice.label}
              checked={selectedLabel === choice.label}
              onChange={() =>
                onChange({
                  ...response,
                  response_payload: {
                    ...response.response_payload,
                    selected_label: choice.label,
                  },
                })
              }
              className="mt-0.5 accent-brand"
            />
            <span className="text-fg text-sm">
              <span className="font-semibold mr-1">{choice.label}.</span>
              {choice.text}
            </span>
          </label>
        ))}
      </div>
    );
  }

  // ── Matching ───────────────────────────────────────────────────────────────
  if (question_type === 'matching') {
    // I2: generation emits `left` / `right` (not `left_items` / `right_items`).
    const leftItems = (payload.left as string[] | undefined) ?? [];
    const rightItems = (payload.right as string[] | undefined) ?? [];
    const pairs = (response.response_payload?.pairs as MatchingPair[] | undefined) ?? [];

    function pairForLeft(leftIdx: number): MatchingPair | undefined {
      return pairs.find((p) => p.left_idx === leftIdx);
    }

    function handleSelect(leftIdx: number, rawValue: string) {
      const rightIdx = Number(rawValue);
      const filtered = pairs.filter((p) => p.left_idx !== leftIdx);
      const next: MatchingPair[] =
        rightIdx >= 0 ? [...filtered, { left_idx: leftIdx, right_idx: rightIdx }] : filtered;
      onChange({
        ...response,
        response_payload: { ...response.response_payload, pairs: next },
      });
    }

    return (
      <div className="space-y-2">
        {leftItems.map((leftText, leftIdx) => {
          const pair = pairForLeft(leftIdx);
          return (
            <div key={leftIdx} className="flex items-center gap-3">
              <span className="text-fg text-sm flex-1">{leftText}</span>
              <select
                aria-label={`Match for: ${leftText}`}
                value={pair?.right_idx ?? -1}
                onChange={(e) => handleSelect(leftIdx, e.target.value)}
                className="border border-surface rounded px-2 py-1 text-fg bg-surface text-sm"
              >
                <option value={-1}>— choose —</option>
                {rightItems.map((rightText, rightIdx) => (
                  <option key={rightIdx} value={rightIdx}>
                    {rightText}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Data interpretation ────────────────────────────────────────────────────
  if (question_type === 'data_interpretation') {
    const mermaid = payload.mermaid as string | undefined;
    return (
      <div className="space-y-3">
        {mermaid != null && mermaid.length > 0 && (
          <pre className="bg-surface border border-surface rounded p-3 overflow-x-auto text-sm text-fg">
            <code>{mermaid}</code>
          </pre>
        )}
        <OpenTextarea
          value={response.response_text ?? ''}
          onChange={(v) => onChange({ ...response, response_text: v })}
          rows={4}
          placeholder="Write your analysis here…"
        />
      </div>
    );
  }

  // ── Open-text types + unknown fallback ─────────────────────────────────────
  // Covers: short_answer, compare_contrast, mini_essay, multi_step_problem, unknown
  const rows =
    question_type === 'mini_essay'
      ? 8
      : question_type === 'compare_contrast'
        ? 6
        : 4;

  return (
    <OpenTextarea
      value={response.response_text ?? ''}
      onChange={(v) => onChange({ ...response, response_text: v })}
      rows={rows}
      placeholder="Write your answer here…"
    />
  );
}

// ── Shared textarea ────────────────────────────────────────────────────────────

function OpenTextarea({
  value,
  onChange,
  rows,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder: string;
}) {
  return (
    <textarea
      aria-label="Answer"
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-surface rounded px-3 py-2 text-fg bg-surface text-sm resize-y"
    />
  );
}
