'use client';

/**
 * QuestionCard — renders a single quiz question by type.
 *
 * MCQ:   choice buttons with label selection stored as the label string (e.g. "A").
 * Numeric: text input with inputMode="decimal" (allows "3/4" fractions — NOT type="number").
 * Open:  resizable textarea.
 *
 * MathText wraps all question text and MCQ choice text.
 * correct_answer and rubric are never rendered (Option-D).
 * onFirstInput fires once per mount (via hasInputtedRef) when student first interacts.
 */

import React, { useRef } from 'react';
import { MathText } from '@/components/core/MathText';

export interface MCQChoice {
  label: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  position: number;
  question_type: 'mcq' | 'numeric' | 'open';
  question_text: string;
  choices: MCQChoice[] | null;
  correct_answer: string;
  rubric: string | null;
  concept_tag: string | null;
  skill_id: string | null;
}

export interface QuestionCardProps {
  question: QuizQuestion;
  currentResponse: string;
  onResponse: (v: string) => void;
  onFirstInput: () => void;
}

export function QuestionCard({ question, currentResponse, onResponse, onFirstInput }: QuestionCardProps) {
  const hasInputtedRef = useRef(false);

  function fireFirstInput() {
    if (!hasInputtedRef.current) {
      hasInputtedRef.current = true;
      onFirstInput();
    }
  }

  const isMCQ     = question.question_type === 'mcq';
  const isNumeric = question.question_type === 'numeric';
  // open-response = !isMCQ && !isNumeric

  return (
    <div className="flex flex-col gap-5">
      {/* Question text */}
      <div className="text-fg text-base leading-relaxed font-medium">
        <MathText>{question.question_text}</MathText>
      </div>

      {/* MCQ choices */}
      {isMCQ && question.choices && (
        <div className="flex flex-col gap-2" role="group" aria-label="Answer choices">
          {question.choices.map((choice) => {
            const isSelected = currentResponse === choice.label;
            return (
              <button
                key={choice.label}
                type="button"
                onClick={() => {
                  fireFirstInput();
                  onResponse(choice.label);
                }}
                aria-pressed={isSelected}
                className={[
                  'flex items-start gap-3 rounded-lg border-2 px-4 py-3 text-left text-sm',
                  'transition-colors duration-100',
                  isSelected
                    ? 'border-brand bg-brand-surface text-brand-fg font-semibold shadow-sticker'
                    : 'border-surface bg-surface text-fg hover:border-brand hover:bg-brand-surface',
                ].join(' ')}
              >
                <span className="shrink-0 font-bold">{choice.label}.</span>
                <MathText>{choice.text}</MathText>
                {isSelected && <span className="ml-auto shrink-0" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Numeric input */}
      {isNumeric && (
        <input
          type="text"
          inputMode="decimal"
          value={currentResponse}
          onChange={(e) => {
            fireFirstInput();
            onResponse(e.target.value);
          }}
          onFocus={fireFirstInput}
          placeholder="Enter your answer"
          className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base
                     focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30
                     placeholder:text-fg-muted"
          aria-label="Numeric answer"
        />
      )}

      {/* Open-response textarea */}
      {!isMCQ && !isNumeric && (
        <textarea
          rows={6}
          value={currentResponse}
          onChange={(e) => {
            fireFirstInput();
            onResponse(e.target.value);
          }}
          onFocus={fireFirstInput}
          placeholder="Write your answer here…"
          style={{ resize: 'vertical' }}
          className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base
                     focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30
                     placeholder:text-fg-muted"
          aria-label="Written answer"
        />
      )}
    </div>
  );
}
