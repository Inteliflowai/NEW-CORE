'use client';

/**
 * HelpTicketModal — floating help/report-issue form.
 *
 * Opened by HelpButton. Accepts subject + description + category + priority +
 * optional screenshot, then POSTs to /api/support/screenshot (if a file is
 * attached) followed by /api/support/tickets.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" + aria-labelledby="help-modal-title"
 *   - Subject field gets autoFocus on open
 *   - Escape key closes via document-level useEffect listener
 *   - Error messages use role="alert"
 *   - Submit button disabled + "Sending…" + aria-busy during request
 *   - All labels wired via htmlFor/id pairs
 *
 * Token-only Tailwind v4. All user-facing strings are DRAFTS → Barb.
 */

import { useEffect, useRef, useState } from 'react';

export interface HelpTicketModalProps {
  onClose: () => void;
}

const INPUT =
  'w-full rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const LABEL = 'block text-sm font-medium text-fg mb-1';

export function HelpTicketModal({ onClose }: HelpTicketModalProps) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Escape key closes the modal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!subject.trim()) {
      setError('Please enter a subject.');
      return;
    }
    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }
    if (!category) {
      setError('Please select a category.');
      return;
    }

    setSending(true);
    try {
      let screenshotPath: string | undefined;

      // Step 1: upload screenshot if one was selected
      if (screenshot) {
        const form = new FormData();
        form.append('file', screenshot);
        const res = await fetch('/api/support/screenshot', { method: 'POST', body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          setError(typeof body.error === 'string' ? body.error : 'Failed to upload screenshot — please try again.');
          setSending(false);
          return;
        }
        const body = await res.json() as Record<string, unknown>;
        screenshotPath = typeof body.path === 'string' ? body.path : undefined;
      }

      // Step 2: create the ticket
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          description,
          category,
          priority,
          ...(screenshotPath !== undefined ? { screenshotPath } : {}),
        }),
      });
      if (!res.ok) {
        setError('Something went wrong — please try again.');
        setSending(false);
        return;
      }
      setSuccess(true);
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-fg/20 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        className="bg-bg text-fg shadow-sticker-lg rounded-lg border-2 border-sidebar-edge w-full max-w-lg mx-4 p-6"
      >
        {success ? (
          <div className="flex flex-col gap-4">
            <p className="text-fg">Your message has been sent. We&apos;ll be in touch soon.</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <h2
                id="help-modal-title"
                className="font-display text-lg font-extrabold text-fg"
              >
                Get help or report an issue
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                ✕
              </button>
            </div>

            {error && (
              <p role="alert" className="mb-4 rounded-md bg-risk-surface p-3 text-sm text-fg">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-4">
                {/* Subject */}
                <div>
                  <label htmlFor="ticket-subject" className={LABEL}>
                    Subject
                  </label>
                  <input
                    ref={subjectRef}
                    id="ticket-subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    className={INPUT}
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="ticket-description" className={LABEL}>
                    Description
                  </label>
                  <textarea
                    id="ticket-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    className={INPUT}
                  />
                </div>

                {/* Category */}
                <div>
                  <label htmlFor="ticket-category" className={LABEL}>
                    Category
                  </label>
                  <select
                    id="ticket-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Select a category</option>
                    <option value="general">General inquiry</option>
                    <option value="bug">Bug report</option>
                    <option value="feature">Feature request</option>
                    <option value="account">Account issue</option>
                    <option value="data">Data question</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label htmlFor="ticket-priority" className={LABEL}>
                    Priority
                  </label>
                  <select
                    id="ticket-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className={INPUT}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                {/* Screenshot */}
                <div>
                  <label htmlFor="ticket-screenshot" className={LABEL}>
                    Attach a screenshot (optional, max 5 MB)
                  </label>
                  <input
                    id="ticket-screenshot"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-fg-muted"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 mt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border-2 border-sidebar-edge px-4 py-2 text-sm font-medium text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sending}
                    aria-busy={sending}
                    className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand shadow-sticker disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
