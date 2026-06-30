'use client';
// src/app/(teacher)/students/[studentId]/_components/QuickHighFiveModal.tsx
// Lightweight High Five composer embedded in the student drill-in header.
// Full HighFiveComposer (at /high-fives) needs class context + suggestions —
// too heavy for inline use. This is a thin textarea → POST variant.
import React, { useState } from 'react';

interface QuickHighFiveModalProps {
  studentId: string;
  classId: string | null;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function QuickHighFiveModal({
  studentId,
  classId,
  studentName,
  isOpen,
  onClose,
}: QuickHighFiveModalProps): React.JSX.Element | null {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  if (!isOpen) return null;

  const noClass = classId === null;
  const canSend = !noClass && text.trim().length > 0 && text.trim().length <= 600 && !busy;

  async function handleSend() {
    if (!canSend || !classId) return;
    setBusy(true);
    setError(null);
    setViolations([]);
    try {
      const res = await fetch('/api/teacher/high-fives/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, class_id: classId, text: text.trim(), ai_drafted: false }),
      });
      if (res.status === 422) {
        const data = await res.json() as { violations: string[] };
        setViolations(data.violations ?? []);
      } else if (!res.ok) {
        setError('Something went wrong. Please try again.');
      } else {
        setSent(true);
        setTimeout(() => {
          setSent(false);
          setText('');
          onClose();
        }, 2000);
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Send High Five to ${studentName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl border-2 border-sidebar-edge bg-bg p-5 shadow-sticker-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-fg text-base">
            High Five — {studentName}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-fg-muted hover:text-fg transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {sent ? (
          <p role="status" className="text-center font-bold text-ok py-4">
            High Five sent! ★
          </p>
        ) : (
          <>
            {noClass && (
              <p className="text-xs text-fg-muted bg-surface rounded-md border-2 border-sidebar-edge px-3 py-2">
                Open this student from a specific class to send a High Five.
              </p>
            )}

            <textarea
              aria-label="High Five note"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={noClass || busy}
              maxLength={600}
              rows={4}
              placeholder={noClass ? '' : `What did ${studentName} do well?`}
              className="w-full resize-none rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1.5 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
            />

            {violations.length > 0 && (
              <ul role="alert" className="text-xs text-fg flex flex-col gap-0.5">
                {violations.map((v, i) => (
                  <li key={i}>⚠ {v}</li>
                ))}
              </ul>
            )}

            {error && (
              <p role="alert" className="text-xs text-fg">{error}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm text-fg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="hf-send"
                onClick={handleSend}
                disabled={!canSend}
                className="rounded-md border-2 border-sidebar-edge bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand shadow-sticker disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default QuickHighFiveModal;
