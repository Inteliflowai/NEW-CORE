'use client';
/**
 * TicketDetail — full ticket view with message thread, reply form, status management.
 *
 * Props:
 *   ticket       — full TicketRow passed from TicketInbox (no separate fetch needed)
 *   adminId      — current admin's user ID (for "You" vs role label in thread)
 *   onStatusChange — callback after a successful status PATCH; TicketInbox uses it
 *                    to re-fetch the ticket list
 *
 * Accessibility:
 *   - Error states are inline (no throw — would break the inbox panel)
 *   - All interactive elements have accessible labels
 *   - Screenshot thumbnail links open in a new tab (rel="noopener noreferrer")
 *
 * All user-visible strings are DRAFT → Barb (STRINGS-FOR-BARB.md §Support Tickets).
 * Token-only Tailwind v4 — no hardcoded hex.
 */

import { useEffect, useState } from 'react';
import type { TicketRow } from './TicketInbox';

// ── Types ──────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  sender_id: string;
  message: string;
  is_internal: boolean;
  created_at: string;
};

interface TicketDetailProps {
  ticket: TicketRow;
  adminId: string;
  onStatusChange?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
};

// ── Component ──────────────────────────────────────────────────────────────────

export function TicketDetail({ ticket, adminId, onStatusChange }: TicketDetailProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(true);
  const [msgError, setMsgError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // localStatus tracks optimistic status updates
  const [localStatus, setLocalStatus] = useState(ticket.status);
  const [statusLoading, setStatusLoading] = useState(false);

  // Re-sync localStatus when a different ticket is passed
  useEffect(() => {
    setLocalStatus(ticket.status);
  }, [ticket.id, ticket.status]);

  // ── Fetch messages ──────────────────────────────────────────────────────────
  const loadMessages = async () => {
    setMsgLoading(true);
    setMsgError(null);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}/messages`);
      if (!res.ok) throw new Error('Could not load messages');
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages);
    } catch (e) {
      setMsgError((e as Error).message || 'Could not load messages');
    } finally {
      setMsgLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  // ── Status change ───────────────────────────────────────────────────────────
  async function changeStatus(newStatus: string) {
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setLocalStatus(newStatus);
      onStatusChange?.();
    } catch {
      // Non-fatal: the button un-disables; admin can retry
    } finally {
      setStatusLoading(false);
    }
  }

  // ── Send reply ──────────────────────────────────────────────────────────────
  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSendError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim(), is_internal: isInternal }),
      });
      if (!res.ok) throw new Error('Failed to send reply');
      setReplyText('');
      setIsInternal(false);
      // Re-fetch messages to show the new message
      await loadMessages();
    } catch {
      setSendError('Something went wrong — please try again.');
    } finally {
      setSending(false);
    }
  }

  // ── Status action buttons (contextual) ─────────────────────────────────────
  function StatusButtons() {
    const BTN =
      'rounded border-2 border-sidebar-edge px-3 py-1.5 text-xs font-semibold shadow-sticker ' +
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
      'disabled:opacity-50 transition-colors';

    if (localStatus === 'open') {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={statusLoading}
            onClick={() => void changeStatus('in_progress')}
            className={`${BTN} bg-brand-surface text-brand-fg hover:bg-brand hover:text-bg`}
          >
            Mark in progress
          </button>
          <button
            type="button"
            disabled={statusLoading}
            onClick={() => void changeStatus('resolved')}
            className={`${BTN} bg-ok-surface text-ok-fg hover:bg-ok hover:text-bg`}
          >
            Resolve
          </button>
        </div>
      );
    }

    if (localStatus === 'in_progress') {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={statusLoading}
            onClick={() => void changeStatus('resolved')}
            className={`${BTN} bg-ok-surface text-ok-fg hover:bg-ok hover:text-bg`}
          >
            Resolve
          </button>
          <button
            type="button"
            disabled={statusLoading}
            onClick={() => void changeStatus('open')}
            className={`${BTN} bg-surface text-fg hover:bg-warn-surface hover:text-warn-fg`}
          >
            Reopen
          </button>
        </div>
      );
    }

    // resolved
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={statusLoading}
          onClick={() => void changeStatus('open')}
          className={`${BTN} bg-surface text-fg hover:bg-warn-surface hover:text-warn-fg`}
        >
          Reopen
        </button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-3 border-b-2 border-sidebar-edge">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-extrabold text-fg leading-tight truncate">
            {ticket.subject}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted flex-wrap">
            <span>
              Status:{' '}
              <span className="font-semibold text-fg">
                {STATUS_LABEL[localStatus] ?? localStatus}
              </span>
            </span>
            <span>·</span>
            <span>{ticket.category}</span>
            <span>·</span>
            <span>{ticket.submitted_by_role}</span>
            {ticket.school_id && (
              <>
                <span>·</span>
                <span>School: {ticket.school_id.slice(0, 8)}</span>
              </>
            )}
            {ticket.assigned_to && (
              <>
                <span>·</span>
                <span>Assigned: {ticket.assigned_to}</span>
              </>
            )}
          </div>
        </div>
        <StatusButtons />
      </div>

      {/* Description */}
      <div className="rounded border-2 border-sidebar-edge bg-surface p-3">
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1">
          Description
        </p>
        <p className="text-sm text-fg whitespace-pre-wrap">{ticket.description}</p>
      </div>

      {/* Screenshot thumbnail */}
      {ticket.screenshot_path && (
        <div>
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1">
            Screenshot
          </p>
          <a
            href={`/api/support/screenshot?path=${encodeURIComponent(ticket.screenshot_path)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View screenshot full size (opens in new tab)"
          >
            <img
              src={`/api/support/screenshot?path=${encodeURIComponent(ticket.screenshot_path)}`}
              alt="Screenshot"
              className="max-w-xs rounded border-2 border-sidebar-edge cursor-pointer hover:opacity-80 transition-opacity"
            />
          </a>
        </div>
      )}

      {/* Message thread */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
          Messages
        </p>

        {msgLoading && (
          <p className="text-sm text-fg-muted" aria-live="polite">
            Loading messages…
          </p>
        )}

        {!msgLoading && msgError && (
          <p className="text-sm text-risk-fg" role="alert">
            {msgError}
          </p>
        )}

        {!msgLoading && !msgError && messages.length === 0 && (
          <p className="text-sm text-fg-muted">No messages yet.</p>
        )}

        {!msgLoading && !msgError && messages.length > 0 && (
          <div className="flex flex-col gap-2 overflow-y-auto">
            {messages.map((msg) => {
              const isFromAdmin = msg.sender_id === adminId;
              const senderLabel = isFromAdmin ? 'You' : ticket.submitted_by_role;

              return (
                <div
                  key={msg.id}
                  className={[
                    'rounded border-2 border-sidebar-edge p-3',
                    msg.is_internal ? 'bg-brand-surface' : 'bg-surface',
                    isFromAdmin ? 'ml-6' : 'mr-6',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs font-semibold text-fg">{senderLabel}</span>
                    <div className="flex items-center gap-1.5">
                      {msg.is_internal && (
                        <span className="text-xs italic text-fg-muted">
                          Internal note — not visible to submitter
                        </span>
                      )}
                      <span className="text-xs text-fg-muted">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-sm text-fg whitespace-pre-wrap">{msg.message}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reply form */}
      <form onSubmit={(e) => void sendReply(e)} className="border-t-2 border-sidebar-edge pt-3 flex flex-col gap-2">
        {sendError && (
          <p role="alert" className="text-sm text-risk-fg">
            {sendError}
          </p>
        )}

        <div>
          <label htmlFor="ticket-reply" className="block text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1">
            Reply
          </label>
          <textarea
            id="ticket-reply"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="Write a reply…"
            className="w-full rounded border-2 border-sidebar-edge bg-bg px-3 py-2 text-sm text-fg
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
              aria-label="Mark as internal — not visible to submitter"
              className="rounded border-2 border-sidebar-edge"
            />
            Mark as internal — not visible to submitter
          </label>

          <button
            type="submit"
            disabled={sending || !replyText.trim()}
            aria-busy={sending}
            className="rounded border-2 border-sidebar-edge bg-brand px-4 py-1.5 text-sm font-semibold text-bg
                       shadow-sticker disabled:opacity-50
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </form>
    </div>
  );
}
