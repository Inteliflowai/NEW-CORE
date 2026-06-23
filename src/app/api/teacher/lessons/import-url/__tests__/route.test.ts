import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const extractTextFromUrl = vi.fn();
const parseLesson = vi.fn();
const lessonInserts: Array<Record<string, unknown>> = [];
let ROLE: string;

class UrlFetchError extends Error {}
class LlmExhaustedError extends Error {
  provider: string;
  constructor(provider: string, message = 'LLM exhausted after retries') {
    super(message);
    this.provider = provider;
    this.name = 'LlmExhaustedError';
  }
}

vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/engine/parseUrl', () => ({ extractTextFromUrl, UrlFetchError }));
vi.mock('@/lib/engine/lessonParse', () => ({ parseLesson }));
vi.mock('@/lib/ai/errors', () => ({ LlmExhaustedError }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: ROLE } }) }) }) };
      return { insert: (row: Record<string, unknown>) => { lessonInserts.push(row); return { select: () => ({ single: async () => ({ data: { id: 'L1', ...row }, error: null }) }) }; } };
    },
  }),
}));

const req = (b: unknown) => new NextRequest('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/lessons/import-url/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); extractTextFromUrl.mockReset(); parseLesson.mockReset();
  lessonInserts.length = 0; ROLE = 'teacher';
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
  extractTextFromUrl.mockResolvedValue('A lesson about volcanoes.');
  parseLesson.mockResolvedValue({ title: 'Volcanoes', subject: 'Science', grade_level: '6', key_concepts: [] });
});

describe('POST /api/teacher/lessons/import-url', () => {
  it('401 / 403 / 400 gates', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    ROLE = 'student';
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(403);
    ROLE = 'teacher';
    expect((await (await load())(req({ class_id: 'c1' }))).status).toBe(400);
  });
  it('403 when guardClassAccess denies', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(403);
  });
  it('happy path → inserts source=url + returns parsed_content', async () => {
    const res = await (await load())(req({ url: 'https://docs.google.com/d/x/pub', class_id: 'c1' }));
    expect(res.status).toBe(200);
    expect(lessonInserts[0]).toMatchObject({ source: 'url', status: 'pending_review', class_id: 'c1', teacher_id: 'u1' });
    const body = await res.json();
    expect(body.lesson_id).toBe('L1');
    expect(body.parsed_content.title).toBe('Volcanoes');
  });
  it('400 url_fetch on UrlFetchError', async () => {
    extractTextFromUrl.mockRejectedValue(new UrlFetchError("can't open"));
    const res = await (await load())(req({ url: 'https://bad', class_id: 'c1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('url_fetch');
  });
  it('503 when parseLesson exhausts the LLM', async () => {
    parseLesson.mockRejectedValue(new LlmExhaustedError('openai'));
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(503);
  });
});
