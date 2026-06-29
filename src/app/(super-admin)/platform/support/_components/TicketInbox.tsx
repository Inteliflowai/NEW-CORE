'use client';
/**
 * TicketInbox — platform-admin support ticket inbox.
 *
 * Two-column layout: tab-filtered ticket list (left) + TicketDetail panel (right).
 * Tab state drives the API fetch; clicking a row selects a ticket and renders TicketDetail.
 *
 * All user-visible strings are DRAFT → Barb (see STRINGS-FOR-BARB.md §Support Tickets).
 * Token-only Tailwind v4 — no hardcoded hex, no border-line.
 */

import { useCallback, useState } from 'react';
import { TicketDetail } from './TicketDetail';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TicketRow = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  submitted_by_role: string;
  school_id: string | null;
  created_at: string;
  assigned_to: string | null;
  description: string;
  screenshot_path: string | null;
};

type Tab = 'open' | 'in_progress' | 'resolved';

interface TicketInboxProps {
  initialTickets: TicketRow[];
  adminId: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS: { value: Tab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
];

// Uses the validated -surface/-fg token pairs (WCAG AA ≥ 4.5:1), following
// the established badge pattern in CLBadge / RiskBadge.
const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-risk-surface text-risk-fg ring-1 ring-risk',
  high:   'bg-warn-surface text-warn-fg',
  normal: 'bg-surface text-fg',
  low:    'bg-surface text-fg-muted',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAge(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TicketInbox({ initialTickets, adminId }: TicketInboxProps) {
  const [tab, setTab] = useState<Tab>('open');
  const [tickets, setTickets] = useState<TicketRow[]>(initialTickets);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  const fetchTickets = useCallback(
    async (status: Tab, nextPage = 0, append = false) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/support/tickets?status=${status}&page=${nextPage}`,
          { headers: { 'Content-Type': 'application/json' } },
        );
        if (!res.ok) throw new Error('Failed to load tickets');
        const data = (await res.json()) as { tickets: TicketRow[]; page: number; hasMore: boolean };
        setTickets((prev) => (append ? [...prev, ...data.tickets] : data.tickets));
        setPage(data.page);
        setHasMore(data.hasMore);
      } catch {
        // Fail silently; tickets remain as-is
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  function changeTab(newTab: Tab) {
    setTab(newTab);
    setSelectedId(null);
    setPage(0);
    setHasMore(false);
    void fetchTickets(newTab, 0, false);
  }

  function loadMore() {
    void fetchTickets(tab, page + 1, true);
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Left panel: tab bar + ticket list ─────────────────────────── */}
      <div className="w-80 shrink-0 border-r-2 border-sidebar-edge flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div
          role="tablist"
          aria-label="Ticket status"
          className="flex border-b-2 border-sidebar-edge shrink-0"
        >
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => changeTab(t.value)}
              className={[
                'flex-1 px-2 py-2.5 text-xs font-semibold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                tab === t.value
                  ? 'bg-brand text-bg border-b-2 border-brand'
                  : 'bg-surface text-fg-muted hover:text-fg hover:bg-brand-surface',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto" role="tabpanel">
          {loading && (
            <p className="p-4 text-sm text-fg-muted" aria-live="polite">
              Loading…
            </p>
          )}
          {!loading && tickets.length === 0 && (
            <p className="p-4 text-sm text-fg-muted">No tickets in this category.</p>
          )}
          {!loading &&
            tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                aria-label={ticket.subject}
                aria-pressed={selectedId === ticket.id}
                onClick={() => setSelectedId(ticket.id)}
                className={[
                  'w-full text-left px-3 py-3 border-b border-sidebar-edge',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  'transition-colors hover:bg-brand-surface',
                  selectedId === ticket.id ? 'bg-brand-surface' : 'bg-surface',
                ].join(' ')}
              >
                {/* Subject */}
                <p className="text-sm font-semibold text-fg truncate">{ticket.subject}</p>

                {/* Badges row */}
                <div className="mt-1 flex items-center flex-wrap gap-1">
                  {/* Category */}
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface text-fg-muted border border-sidebar-edge">
                    {ticket.category}
                  </span>

                  {/* Priority */}
                  <span
                    className={[
                      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
                      PRIORITY_BADGE[ticket.priority] ?? PRIORITY_BADGE.normal,
                    ].join(' ')}
                  >
                    {ticket.priority}
                  </span>
                </div>

                {/* Meta row */}
                <div className="mt-1 flex items-center justify-between gap-1 text-xs text-fg-muted">
                  <span>{ticket.submitted_by_role}</span>
                  <span>{formatAge(ticket.created_at)}</span>
                </div>

                {/* Assigned-to initials */}
                {ticket.assigned_to && (
                  <p className="mt-0.5 text-xs text-fg-muted truncate">
                    Assigned: {ticket.assigned_to.slice(0, 8)}
                  </p>
                )}
              </button>
            ))}

          {/* Load more */}
          {hasMore && !loading && (
            <div className="p-3">
              <button
                type="button"
                onClick={loadMore}
                className="w-full rounded border-2 border-sidebar-edge bg-surface px-3 py-2 text-sm font-medium text-fg
                           hover:bg-brand-surface shadow-sticker
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: ticket detail ─────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto" aria-live="polite">
        {selectedTicket ? (
          <TicketDetail
            ticket={selectedTicket}
            adminId={adminId}
            onStatusChange={() => void fetchTickets(tab, 0, false)}
          />
        ) : (
          <div className="flex items-center justify-center h-full p-8">
            <p className="text-fg-muted text-sm">Select a ticket to view details.</p>
          </div>
        )}
      </div>
    </div>
  );
}
