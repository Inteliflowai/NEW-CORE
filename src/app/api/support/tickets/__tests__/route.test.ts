// src/app/api/support/tickets/__tests__/route.test.ts
// Node env — no jsdom needed (server route test).
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── State variables ──────────────────────────────────────────────────────────
const getUser = vi.fn();

// Shared DB state — modified per test
let USER_ROLE = 'teacher';
let USER_SCHOOL_ID: string | null = 'school-1';

// POST — what insert().select().single() returns
let INSERT_RESULT: { data: { id: string } | null; error: unknown } = {
  data: { id: 'ticket-1' },
  error: null,
};

// GET — what the support_tickets select chain resolves with
let TICKETS_DATA: unknown[] | null = [];
let TICKETS_ERROR: unknown = null;

// Capture arrays — reset in beforeEach
const insertPayloads: Array<Record<string, unknown>> = [];
let lastTicketsSelect = '';
const ticketsEqCalls: Array<[string, unknown]> = [];

// ─── Chain type (avoids circular-initializer TS error) ───────────────────────

interface TicketQueryChain {
  order(): TicketQueryChain;
  eq(col: string, val: unknown): TicketQueryChain;
  range(): TicketQueryChain;
  then(
    resolve: (v: { data: unknown[] | null; error: unknown }) => unknown,
    reject?: (e: unknown) => unknown,
  ): Promise<unknown>;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
  }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        // Used by both POST and GET to fetch role (and school_id for POST)
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { role: USER_ROLE, school_id: USER_SCHOOL_ID },
              }),
            }),
          }),
        };
      }

      // support_tickets
      return {
        // POST: .insert().select('id').single()
        insert: (payload: Record<string, unknown>) => {
          insertPayloads.push({ ...payload });
          return {
            select: () => ({
              single: async () => INSERT_RESULT,
            }),
          };
        },

        // GET: fluent chain → thenable
        select: (cols: string): TicketQueryChain => {
          lastTicketsSelect = cols;
          // Build a chain where each method returns `chain` and the whole thing
          // is awaitable via a `then` method (PromiseLike contract).
          const chain: TicketQueryChain = {
            order() { return chain; },
            eq(col: string, val: unknown) {
              ticketsEqCalls.push([col, val]);
              return chain;
            },
            range() { return chain; },
            then(
              resolve: (v: { data: unknown[] | null; error: unknown }) => unknown,
              reject?: (e: unknown) => unknown,
            ): Promise<unknown> {
              return Promise.resolve({ data: TICKETS_DATA, error: TICKETS_ERROR }).then(
                resolve,
                reject,
              );
            },
          };
          return chain;
        },
      };
    },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postReq(body: unknown) {
  return new Request('http://localhost/api/support/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(
    `http://localhost/api/support/tickets${qs ? `?${qs}` : ''}`,
  ) as unknown as import('next/server').NextRequest;
}

async function load() {
  vi.resetModules();
  return await import('@/app/api/support/tickets/route');
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  insertPayloads.length = 0;
  ticketsEqCalls.length = 0;
  lastTicketsSelect = '';
  USER_ROLE = 'teacher';
  USER_SCHOOL_ID = 'school-1';
  INSERT_RESULT = { data: { id: 'ticket-1' }, error: null };
  TICKETS_DATA = [];
  TICKETS_ERROR = null;
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
});

// ─── POST tests ───────────────────────────────────────────────────────────────

describe('POST /api/support/tickets', () => {
  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await load();
    const res = await POST(postReq({ subject: 'Test', description: 'Test' }) as never);
    expect(res.status).toBe(401);
  });

  it('returns 400 when subject is missing', async () => {
    const { POST } = await load();
    const res = await POST(postReq({ description: 'Some description' }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when category value is invalid', async () => {
    const { POST } = await load();
    const res = await POST(
      postReq({ subject: 'Test', description: 'Test', category: 'invalid_cat' }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 201 with ticketId and inserts with submitted_by_role from DB', async () => {
    USER_ROLE = 'teacher';
    const { POST } = await load();
    const res = await POST(
      postReq({ subject: 'My subject', description: 'My description' }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ticketId).toBe('ticket-1');
    expect(insertPayloads.length).toBe(1);
    expect(insertPayloads[0].submitted_by_role).toBe('teacher');
    expect(insertPayloads[0].submitted_by).toBe('u1');
  });

  it('inserts with school_id: null for a parent user (not an error)', async () => {
    USER_ROLE = 'parent';
    USER_SCHOOL_ID = null;
    const { POST } = await load();
    const res = await POST(
      postReq({ subject: 'Help', description: 'Parent question' }) as never,
    );
    expect(res.status).toBe(201);
    expect(insertPayloads.length).toBe(1);
    expect(insertPayloads[0].school_id).toBeNull();
  });

  it('returns 400 when screenshotPath does not start with support-uploads/', async () => {
    const { POST } = await load();
    const res = await POST(
      postReq({
        subject: 'Test',
        description: 'Test',
        screenshotPath: 'avatars/u1/screenshot.png',
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/support/tickets', () => {
  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await load();
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin without ?mine=1', async () => {
    USER_ROLE = 'teacher';
    const { GET } = await load();
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  it('returns 200 with own tickets for ?mine=1; no priority in select; eq submitted_by called', async () => {
    USER_ROLE = 'teacher';
    TICKETS_DATA = [
      {
        id: 't1',
        subject: 'My ticket',
        category: 'general',
        status: 'open',
        created_at: '2026-06-01T00:00:00Z',
      },
    ];
    const { GET } = await load();
    const res = await GET(getReq('mine=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(body.tickets).toHaveLength(1);
    // priority MUST NOT be in the own-tickets select (submitters don't see priority)
    expect(lastTicketsSelect).not.toContain('priority');
    // eq('submitted_by', userId) must have been called
    expect(ticketsEqCalls).toContainEqual(['submitted_by', 'u1']);
  });

  it('returns 200 with all tickets for platform_admin (no filter)', async () => {
    USER_ROLE = 'platform_admin';
    TICKETS_DATA = [
      {
        id: 't1',
        subject: 'A ticket',
        category: 'bug',
        priority: 'high',
        status: 'open',
        submitted_by_role: 'teacher',
        school_id: 'school-1',
        created_at: '2026-06-01T00:00:00Z',
        assigned_to: null,
      },
    ];
    const { GET } = await load();
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(typeof body.page).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
  });

  it('returns 200 filtered by status=open for platform_admin and calls .eq("status", "open")', async () => {
    USER_ROLE = 'platform_admin';
    TICKETS_DATA = [{ id: 't2', status: 'open' }];
    const { GET } = await load();
    const res = await GET(getReq('status=open'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    // The status filter must have been applied via .eq('status', 'open')
    expect(ticketsEqCalls).toContainEqual(['status', 'open']);
  });
});
