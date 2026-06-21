'use client';

/**
 * TeliPanel — inline Socratic tutor for the Assignment Player.
 *
 * Mounts under the TaskCard. Two-button UI: "Ask Teli" (free question,
 * is_help_request:false) and "I'm stuck — get a hint" (hint pull,
 * is_help_request:true). The server decides the rung and remaining count;
 * the client only renders what comes back.
 *
 * Resets its conversation when the `step` prop changes (the ladder is per-task).
 *
 * Copy = DRAFTS → Barb (STRINGS-FOR-BARB.md §Teli-Tutor).
 */

import React, { useState, useEffect, useRef } from 'react';
import type { HintRung } from '@/lib/teli/ladder';

export interface TeliPanelProps {
  attemptId: string;
  step: number;
  taskDescription: string;
}

interface Message {
  role: 'student' | 'teli';
  content: string;
  rung?: HintRung | null;
}

/** Rung labels shown as small tags on Teli replies. DRAFT → Barb. */
const RUNG_LABELS: Record<HintRung, string> = {
  nudge: 'A nudge',
  cue: 'A cue',
  step: 'First step',
  encourage: 'Keep going',
};

/** DRAFT intro shown before the student interacts. → Barb. */
const INTRO_TEXT =
  "Hi! I'm Teli 👋 Stuck on this one? Ask me anything — I'll help you think it through.";

/** Shown while the model is generating. → Barb. */
const THINKING_TEXT = "Teli's thinking…";

export function TeliPanel({ attemptId, step, taskDescription }: TeliPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [hintsRemaining, setHintsRemaining] = useState<number | null>(null);

  // Reset conversation when step changes (ladder is per-task).
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current !== step) {
      prevStepRef.current = step;
      setMessages([]);
      setInput('');
      setThinking(false);
      setHintsRemaining(null);
    }
  }, [step]);

  async function send(isHelpRequest: boolean) {
    const text = input.trim();
    if (!text || thinking) return;

    // Append student turn immediately.
    setMessages((prev) => [...prev, { role: 'student', content: text }]);
    setInput('');
    setThinking(true);

    try {
      const res = await fetch('/api/attempts/homework-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attemptId,
          task_step: step,
          student_message: text,
          is_help_request: isHelpRequest,
        }),
      });

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'teli',
            content:
              "Something went wrong — try again in a moment.",
            rung: null,
          },
        ]);
        return;
      }

      const data = (await res.json()) as {
        reply: string;
        hint_rung: HintRung | null;
        hints_remaining: number | null;
      };

      setMessages((prev) => [
        ...prev,
        {
          role: 'teli',
          content: data.reply,
          rung: data.hint_rung,
        },
      ]);

      if (data.hints_remaining !== null) {
        setHintsRemaining(data.hints_remaining);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'teli',
          content: "Something went wrong — try again in a moment.",
          rung: null,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  // Hints pill text.
  function pillText(): string | null {
    if (hintsRemaining === null) return null;
    if (hintsRemaining === 0) return "No hints left — you’ve got this";
    return `${hintsRemaining} hints left`;
  }

  const pill = pillText();

  return (
    <div
      data-testid="teli-panel"
      className="rounded-2xl border border-surface bg-surface p-4 flex flex-col gap-3"
    >
      {/* Intro bubble — always visible */}
      <p className="text-fg text-sm">{INTRO_TEXT}</p>

      {/* Message thread */}
      {messages.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Teli conversation">
          {messages.map((msg, i) => (
            <li
              key={i}
              className={
                msg.role === 'student'
                  ? 'self-end bg-brand-surface rounded-xl px-3 py-2 text-fg text-sm max-w-[80%]'
                  : 'self-start bg-surface rounded-xl px-3 py-2 text-fg text-sm max-w-[80%]'
              }
            >
              {msg.role === 'teli' && msg.rung && (
                <span className="block text-xs text-fg-muted mb-1">
                  {RUNG_LABELS[msg.rung]}
                </span>
              )}
              {msg.content}
            </li>
          ))}
        </ul>
      )}

      {/* Thinking indicator */}
      {thinking && (
        <p className="text-fg-muted text-sm italic" aria-live="polite">
          {THINKING_TEXT}
        </p>
      )}

      {/* Hints remaining pill */}
      {pill && (
        <p className="text-fg-muted text-xs" aria-live="polite">
          {pill}
        </p>
      )}

      {/* Input + actions */}
      <div className="flex flex-col gap-2">
        <label htmlFor="teli-input" className="sr-only">
          Ask Teli a question
        </label>
        <textarea
          id="teli-input"
          role="textbox"
          className="w-full rounded-lg border border-surface bg-bg text-fg text-sm px-3 py-2 resize-none min-h-[60px]"
          placeholder="Type your question or thought…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={thinking}
          aria-label="Ask Teli a question"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void send(false)}
            disabled={thinking || !input.trim()}
            className="bg-surface border border-surface text-fg hover:bg-brand-surface text-sm px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Ask Teli
          </button>
          <button
            type="button"
            onClick={() => void send(true)}
            disabled={thinking || !input.trim()}
            className="bg-brand text-fg-on-brand hover:opacity-90 text-sm px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {/* DRAFT → Barb */}
            {`I'm stuck — get a hint`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TeliPanel;
