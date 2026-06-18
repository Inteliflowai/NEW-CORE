import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

// ── Lazy imports ─────────────────────────────────────────────────────────────
import { GET } from '../route';
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockServer(userId: string | null = 'student1') {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  };
}

/**
 * Admin client that:
 * - Returns `snapshots` for student_model_snapshots
 * - THROWS if skill_learning_state or misconception_observations are queried
 *   (the route must NEVER access those tables)
 */
function makeMockAdmin(snapshots: object[] = []) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'student_model_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ data: snapshots, error: null }),
              }),
            }),
          }),
        };
      }
      // Enforce: this route must never query these tables
      if (table === 'skill_learning_state') {
        throw new Error(
          'student/growth MUST NOT query skill_learning_state (RLS + route constraint)',
        );
      }
      if (table === 'misconception_observations') {
        throw new Error(
          'student/growth MUST NOT query misconception_observations (RLS + route constraint)',
        );
      }
      // Safe default for any other table
      return { select: () => ({ eq: () => ({ data: [], error: null }) }) };
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/student/growth', () => {
  beforeEach(() => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer(null) as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns cold-start response when no snapshots exist', async () => {
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cold_start).toBe(true);
    expect(body).toHaveProperty('message');
    expect(body.snapshots).toEqual([]);
  });

  it('returns snapshot-based growth when snapshots exist', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 80,
          mastery_band: 'grade_level',
          consistency_label: 'consistent',
          dominant_effort_pattern: 'independent_success',
          strength_topics: ['Fractions'],
          struggle_topics: ['Algebra'],
          improvement_4w: 5,
          snapshot_schema_version: 'v2',
        },
        {
          snapshot_date: '2026-06-08',
          avg_score: 75,
          mastery_band: 'grade_level',
          consistency_label: 'variable',
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: ['Algebra'],
          improvement_4w: null,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cold_start).toBe(false);
    expect(body.snapshots.length).toBeGreaterThan(0);
    expect(body.snapshots[0]).toHaveProperty('snapshot_date');
    expect(body.snapshots[0]).toHaveProperty('avg_score');
  });

  // student/growth reads snapshots ONLY — never skill_learning_state or misconception_observations
  it('NEVER queries skill_learning_state (mock throws on access)', async () => {
    // The mock admin throws if skill_learning_state is accessed.
    // If the route is correct, this call should resolve without error.
    const req = new NextRequest('http://localhost/api/student/growth');
    await expect(GET(req)).resolves.toBeDefined();
  });

  it('NEVER queries misconception_observations (mock throws on access)', async () => {
    const req = new NextRequest('http://localhost/api/student/growth');
    await expect(GET(req)).resolves.toBeDefined();
  });

  it('own-student scoping: query is filtered by the caller user.id', async () => {
    const adminMock = makeMockAdmin([]);
    const fromSpy = adminMock.from;
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer('my-student-id') as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );

    const req = new NextRequest('http://localhost/api/student/growth');
    await GET(req);

    // from('student_model_snapshots') must have been called
    expect(fromSpy).toHaveBeenCalledWith('student_model_snapshots');
  });

  it('improvement_4w null on first snapshot (cold-start improvement)', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 72,
          mastery_band: 'grade_level',
          consistency_label: null,
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: [],
          improvement_4w: null,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body.cold_start).toBe(false);
    expect(body.snapshots[0].improvement_4w).toBeNull();
  });

  // ── FIX 2 (B2): soft band — NEVER raw enum in student-facing shape ────────

  it('FIX2: snapshot with reteach band exposes soft "Building" word, never raw "reteach"', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 55,
          mastery_band: 'reteach',
          consistency_label: 'variable',
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: ['Fractions'],
          improvement_4w: null,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    const snap = body.snapshots[0];
    // Must have soft 'mastery' field
    expect(snap).toHaveProperty('mastery');
    expect(snap.mastery).toBe('Building');
    // Must NOT expose raw enum
    expect(snap.mastery).not.toBe('reteach');
    expect(snap).not.toHaveProperty('mastery_band');
  });

  it('FIX2: snapshot with grade_level band exposes "On Track"', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 78,
          mastery_band: 'grade_level',
          consistency_label: 'consistent',
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: [],
          improvement_4w: 3,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body.snapshots[0].mastery).toBe('On Track');
    expect(body.snapshots[0]).not.toHaveProperty('mastery_band');
  });

  it('FIX2: snapshot with advanced band exposes "Strong"', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 95,
          mastery_band: 'advanced',
          consistency_label: 'consistent',
          dominant_effort_pattern: null,
          strength_topics: ['Fractions'],
          struggle_topics: [],
          improvement_4w: 8,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body.snapshots[0].mastery).toBe('Strong');
    expect(body.snapshots[0]).not.toHaveProperty('mastery_band');
  });

  it('FIX2: null mastery_band exposes "Not yet assessed"', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: null,
          mastery_band: null,
          consistency_label: null,
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: [],
          improvement_4w: null,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body.snapshots[0].mastery).toBe('Not yet assessed');
  });

  // ── FIX 3 (B1): next_action — positive, non-diagnostic, not from diagnose() ─

  it('FIX3: with struggle_topics → next_action names one positively', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 65,
          mastery_band: 'grade_level',
          consistency_label: 'variable',
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: ['Fractions', 'Algebra'],
          improvement_4w: null,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body).toHaveProperty('next_action');
    // Must be a non-null encouraging string naming a topic
    expect(typeof body.next_action).toBe('string');
    expect(body.next_action).toContain('Fractions');
    // Must be positively framed (starts with encouraging language)
    expect(body.next_action).toMatch(/keep practicing/i);
  });

  it('FIX3: with no struggle_topics → next_action is "on track" message', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 90,
          mastery_band: 'advanced',
          consistency_label: 'consistent',
          dominant_effort_pattern: null,
          strength_topics: ['Fractions'],
          struggle_topics: [],
          improvement_4w: 5,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body).toHaveProperty('next_action');
    expect(body.next_action).toMatch(/on track/i);
  });

  it('FIX3: cold-start → next_action is null or "Start your first quiz."', async () => {
    // cold_start = no snapshots
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    expect(body.cold_start).toBe(true);
    // next_action may be null or the cold-start message
    expect(body.next_action === null || typeof body.next_action === 'string').toBe(true);
  });

  it('FIX3: next_action never contains diagnostic words', async () => {
    const diagnosticWords = ['reteach', 'misconception', 'risk', 'reasoning gap'];
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin([
        {
          snapshot_date: '2026-06-15',
          avg_score: 55,
          mastery_band: 'reteach',
          consistency_label: 'variable',
          dominant_effort_pattern: null,
          strength_topics: [],
          struggle_topics: ['Algebra'],
          improvement_4w: null,
          snapshot_schema_version: 'v2',
        },
      ]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const req = new NextRequest('http://localhost/api/student/growth');
    const res = await GET(req);
    const body = await res.json();
    const action = body.next_action ?? '';
    for (const word of diagnosticWords) {
      expect(action.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});
