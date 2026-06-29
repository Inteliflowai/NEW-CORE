// Tests for POST + GET /api/support/tickets/[id]/messages
// Node env — no jsdom needed (server route test).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mutable state ────────────────────────────────────────────────────────────
const getUser = vi.fn();

// Ticket lookup: null = ticket not found; string = the ticket's submitted_by
let TICKET_SUBMITTER: string | null = 'user-1';
let USER_ROLE = 'teacher';
let INSERT_ERROR: unknown = null;
let MESSAGES_DATA: unknown[] = [];

// Capture arrays — reset in beforeEach
const insertedMessages: unknown[] = [];
const messagesEqCalls: Array<[string, unknown]> = [];

// ─── Chain type for the messages select builder ───────────────────────────────

interface MessagesChain {
  eq(col: string, val: unknown): MessagesChain;
  order(col: string, opts?: object): Promise<{ data: unknown[]; error: unknown }>;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
  }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      // ── Ticket ownership lookup ─────────────────────────────────────────────
      if (table === 'support_tickets') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    TICKET_SUBMITTER !== null
                      ? { submitted_by: TICKET_SUBMITTER }
                      : null,
                }),
            }),
          }),
        };
      }

      // ── Caller role lookup ──────────────────────────────────────────────────
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { role: USER_ROLE } }),
            }),
          }),
        };
      }

      // ── Messages table ──────────────────────────────────────────────────────
      if (table === 'support_ticket_messages') {
        return {
          // POST path: insert and return
          insert: (payload: unknown) => {
            insertedMessages.push(payload);
            return Promise.resolve({ error: INSERT_ERROR });
          },
          // GET path: fluent filter chain → order → result
          select: (): MessagesChain => {
            const chain: MessagesChain = {
              eq(col: string, val: unknown) {
                messagesEqCalls.push([col, val]);
                return chain;
              },
              order() {
                return Promise.resolve({ data: MESSAGES_DATA, error: null });
              },
            };
            return chain;
          },
        };
      }

      return {};
    },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PARAMS = Promise.resolve({ id: 'ticket-1' });

function postReq(body: object) {
  return new NextRequest('http://x/api/support/tickets/ticket-1/messages', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function getReq() {
  return new NextRequest('http://x/api/support/tickets/ticket-1/messages', {
    method: 'GET',
  });
}

beforeEach(() => {
  getUser.mockReset();
  insertedMessages.length = 0;
  messagesEqCalls.length = 0;
  TICKET_SUBMITTER = 'user-1';
  USER_ROLE = 'teacher';
  INSERT_ERROR = null;
  MESSAGES_DATA = [];
  // Default: authenticated as the ticket submitter
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

// ─── POST tests ───────────────────────────────────────────────────────────────

describe('POST /api/support/tickets/[id]/messages', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await POST(postReq({ message: 'Hello' }), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it('403 for non-participant (not submitter, not platform_admin)', async () => {
    // user-2 is NOT the submitter (user-1) and is NOT platform_admin
    getUser.mockResolvedValue({ data: { user: { id: 'user-2' } } });
    USER_ROLE = 'teacher';
    TICKET_SUBMITTER = 'user-1';
    const { POST } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await POST(postReq({ message: 'Sneaky' }), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it('201 — submitter: is_internal forced to false even if body sends true', async () => {
    // user-1 is the submitter, role=teacher (non-admin)
    TICKET_SUBMITTER = 'user-1';
    USER_ROLE = 'teacher';
    const { POST } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await POST(
      postReq({ message: 'My question', is_internal: true }),
      { params: PARAMS },
    );
    expect(res.status).toBe(201);
    expect(insertedMessages).toHaveLength(1);
    expect((insertedMessages[0] as Record<string, unknown>).is_internal).toBe(false);
  });

  it('201 — platform_admin: is_internal preserved as true when body sends true', async () => {
    // Admin is authenticated; ticket submitter is irrelevant (admin is always allowed)
    USER_ROLE = 'platform_admin';
    TICKET_SUBMITTER = 'user-1'; // admin is NOT the submitter
    getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
    const { POST } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await POST(
      postReq({ message: 'Internal note', is_internal: true }),
      { params: PARAMS },
    );
    expect(res.status).toBe(201);
    expect(insertedMessages).toHaveLength(1);
    expect((insertedMessages[0] as Record<string, unknown>).is_internal).toBe(true);
  });

  it('400 when message is empty string', async () => {
    const { POST } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await POST(postReq({ message: '' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it('400 when message is whitespace only', async () => {
    const { POST } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await POST(postReq({ message: '   ' }), { params: PARAMS });
    expect(res.status).toBe(400);
  });
});

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/support/tickets/[id]/messages', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await GET(getReq(), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it('403 for non-participant', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-2' } } });
    USER_ROLE = 'teacher';
    TICKET_SUBMITTER = 'user-1';
    const { GET } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await GET(getReq(), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it('200 — submitter: .eq("is_internal", false) filter is applied', async () => {
    // user-1 is the submitter, role=teacher (non-admin)
    TICKET_SUBMITTER = 'user-1';
    USER_ROLE = 'teacher';
    MESSAGES_DATA = [
      { id: 'm1', sender_id: 'user-1', message: 'Hello', is_internal: false, created_at: '2026-06-01T00:00:00Z' },
    ];
    const { GET } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await GET(getReq(), { params: PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
    // Belt-and-suspenders filter MUST have been applied
    expect(messagesEqCalls).toContainEqual(['is_internal', false]);
  });

  it('200 — platform_admin: .eq("is_internal", false) filter is NOT applied', async () => {
    USER_ROLE = 'platform_admin';
    TICKET_SUBMITTER = 'user-1';
    getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
    MESSAGES_DATA = [
      { id: 'm1', sender_id: 'admin-1', message: 'Internal', is_internal: true, created_at: '2026-06-01T00:00:00Z' },
    ];
    const { GET } = await import('@/app/api/support/tickets/[id]/messages/route');
    const res = await GET(getReq(), { params: PARAMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
    // The is_internal filter MUST NOT have been applied for platform_admin
    const isInternalFilterCalled = messagesEqCalls.some(([col]) => col === 'is_internal');
    expect(isInternalFilterCalled).toBe(false);
  });
});
