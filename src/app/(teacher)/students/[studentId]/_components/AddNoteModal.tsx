'use client';
// src/app/(teacher)/students/[studentId]/_components/AddNoteModal.tsx
// Private per-student teacher notes composer, embedded in the student drill-in
// header. Mirrors QuickHighFiveModal's dialog structure/tokens exactly, with
// two deliberate differences: (1) it also lists the caller's own prior notes
// (fetched on open — GATED on isOpen so a closed modal never fires a stray
// authenticated GET on every page view), and (2) a successful save stays open
// (shows "Saved." + a refreshed list) rather than auto-closing — a teacher may
// want to add more context right after reading their earlier notes.
import React, { useEffect, useState } from 'react';

interface AddNoteModalProps {
  studentId: string;
  classId: string | null;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface NoteRow {
  id: string;
  note_text: string;
  created_at: string;
}

const MAX_NOTE = 2000;

export function AddNoteModal({
  studentId,
  classId,
  studentName,
  isOpen,
  onClose,
}: AddNoteModalProps): React.JSX.Element | null {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState<NoteRow[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teacher/students/notes?studentId=${encodeURIComponent(studentId)}`);
        if (!res.ok) return;
        const data = await res.json() as { notes: NoteRow[] };
        if (!cancelled) setNotes(data.notes ?? []);
      } catch {
        // silent — the earlier-notes list is a nice-to-have; the compose box still works
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, studentId]);

  if (!isOpen) return null;

  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_NOTE && !busy;

  async function refreshNotes() {
    try {
      const res = await fetch(`/api/teacher/students/notes?studentId=${encodeURIComponent(studentId)}`);
      if (!res.ok) return;
      const data = await res.json() as { notes: NoteRow[] };
      setNotes(data.notes ?? []);
    } catch {
      // silent — see effect above
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/teacher/students/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, class_id: classId, text: trimmed }),
      });
      if (!res.ok) {
        setError("Something went wrong — your note wasn’t saved. Try again.");
      } else {
        setSaved(true);
        setText('');
        await refreshNotes();
      }
    } catch {
      setError("Something went wrong — your note wasn’t saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add a note about ${studentName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl border-2 border-sidebar-edge bg-bg p-5 shadow-sticker-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-fg text-base">
            Add a note about {studentName}
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

        <p className="text-xs text-fg-muted">Only you can see these notes.</p>

        <textarea
          aria-label="Note"
          value={text}
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
          disabled={busy}
          maxLength={MAX_NOTE}
          rows={4}
          placeholder="What do you want to remember?"
          className="w-full resize-none rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1.5 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        />

        {saved && (
          <p role="status" className="text-center font-bold text-ok py-1">
            Saved.
          </p>
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
            data-testid="note-save"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md border-2 border-sidebar-edge bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand shadow-sticker disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>

        {notes.length > 0 && (
          <div className="flex flex-col gap-2 border-t-2 border-sidebar-edge pt-3">
            <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wide">
              Your earlier notes
            </h3>
            <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1.5">
                  <p className="text-sm text-fg">{n.note_text}</p>
                  <p className="text-xs text-fg-muted">{new Date(n.created_at).toLocaleDateString()}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default AddNoteModal;
