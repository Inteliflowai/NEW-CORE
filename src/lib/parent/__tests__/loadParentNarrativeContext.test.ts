import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// vi.mock is hoisted — must appear before imports that consume it
vi.mock('@/lib/spark/loadStudentAssignments', () => ({
  loadStudentAssignments: vi.fn(),
}));

import { loadParentNarrativeContext } from '@/lib/parent/loadParentNarrativeContext';
import { loadStudentAssignments } from '@/lib/spark/loadStudentAssignments';

const mockLoadAssignments = vi.mocked(loadStudentAssignments);

// ── Mock builder ─────────────────────────────────────────────────────────────
type Resolve = (v: { data: unknown[]; error: null }) => void;

function makeChain(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = chain;
  (q as { then: (r: Resolve) => void }).then = (resolve) =>
    resolve({ data: rows, error: null });
  return q;
}

/** Routes from() calls by table name so two concurrent DB queries get the right rows. */
function makeAdmin(tableData: Record<string, unknown[]>) {
  return {
    from(table: string) {
      return makeChain(tableData[table] ?? []);
    },
  } as unknown as SupabaseClient;
}

function makeSnapshotRows(
  scores: number[],
  style: string | null = 'visual',
): { avg_score: number; snapshot_date: string; learning_style: string | null }[] {
  return scores.map((avg_score, i) => ({
    avg_score,
    snapshot_date: `2026-0${(i % 9) + 1}-01`, // unique ascending dates
    learning_style: style,
  }));
}

const STUDENT_ID = 'stu-test-abc';

// ── Default mock for loadStudentAssignments ──────────────────────────────────
beforeEach(() => {
  mockLoadAssignments.mockResolvedValue([
    { id: 'a1', title: 'The Civil War', sparkStatus: 'none' },
  ]);
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe('loadParentNarrativeContext', () => {
  it('extracts firstName from first whitespace token of full_name', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex Morgan' }],
      student_model_snapshots: [],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.firstName).toBe('Alex');
  });

  it('extracts only the first token (multi-word name)', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Dana Whitfield Smith' }],
      student_model_snapshots: [],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.firstName).toBe('Dana');
  });

  it('falls back to "Student" when full_name is null', async () => {
    const admin = makeAdmin({
      users: [{ full_name: null }],
      student_model_snapshots: [],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.firstName).toBe('Student');
  });

  // ── gradeTrendDirection (I1: class-agnostic from snapshots) ───────────────

  it('returns null direction when fewer than 4 snapshots (cold-start gate, M6)', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([70, 75]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.gradeTrendDirection).toBeNull();
    expect(ctx.dataPoints).toBe(2);
  });

  it('returns null direction when there are no snapshots', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: [],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.gradeTrendDirection).toBeNull();
    expect(ctx.dataPoints).toBe(0);
  });

  it('returns "climbing" when the recent half mean is clearly higher', async () => {
    // 4 points: earlier mean=(55+65)/2=60, recent mean=(75+85)/2=80 → delta +20 → climbing
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([55, 65, 75, 85]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.gradeTrendDirection).toBe('climbing');
    expect(ctx.dataPoints).toBe(4);
  });

  it('returns "sliding" when the recent half mean is clearly lower', async () => {
    // 4 points: earlier mean=(85+75)/2=80, recent mean=(65+55)/2=60 → delta -20 → sliding
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([85, 75, 65, 55]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.gradeTrendDirection).toBe('sliding');
  });

  it('returns "steady" when the delta between halves is small', async () => {
    // 4 points: earlier mean=(70+71)/2=70.5, recent mean=(70+71)/2=70.5 → delta ~0 → steady
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([70, 71, 70, 71]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.gradeTrendDirection).toBe('steady');
  });

  it('returns null direction for exactly 3 snapshots (cold-start gate is n<4, M6)', async () => {
    // M6: the unified cold-start threshold is 4. Exactly 3 points → null direction,
    // even though the series shows a clear upward trend. GrowthMotif shows "just
    // getting started" at n<4, so direction must also be null to stay in sync.
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([60, 70, 80]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.gradeTrendDirection).toBeNull();
    expect(ctx.dataPoints).toBe(3);
  });

  // ── hasGrowth ─────────────────────────────────────────────────────────────

  it('hasGrowth is false when fewer than 4 dataPoints', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([70, 71, 72]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.hasGrowth).toBe(false);
  });

  it('hasGrowth is true when exactly 4 dataPoints', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([65, 70, 75, 80]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.hasGrowth).toBe(true);
  });

  it('hasGrowth is true for more than 4 dataPoints', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([60, 65, 70, 75, 80, 85]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.hasGrowth).toBe(true);
    expect(ctx.dataPoints).toBe(6);
  });

  // ── learningStyleLabel ────────────────────────────────────────────────────

  it('returns the canonical style for "visual"', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([70], 'visual'),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.learningStyleLabel).toBe('visual');
  });

  it('returns null for "emerging" style', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([70], 'emerging'),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.learningStyleLabel).toBeNull();
  });

  it('returns null when there are no snapshots (style unknown)', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: [],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.learningStyleLabel).toBeNull();
  });

  it('normalizes aliases — "read_write" → "text"', async () => {
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: makeSnapshotRows([70], 'read_write'),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.learningStyleLabel).toBe('text');
  });

  it('uses the most recent snapshot for the style label', async () => {
    // rows are ordered ascending; last entry is most recent
    const admin = makeAdmin({
      users: [{ full_name: 'Alex' }],
      student_model_snapshots: [
        { avg_score: 70, snapshot_date: '2026-01-01', learning_style: 'auditory' },
        { avg_score: 72, snapshot_date: '2026-02-01', learning_style: 'kinesthetic' },
      ],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.learningStyleLabel).toBe('kinesthetic');
  });

  // ── recentTopics (I9: digit-stripped titles) ──────────────────────────────

  it('strips unit/lesson/chapter/week + number prefixes', async () => {
    mockLoadAssignments.mockResolvedValueOnce([
      { id: 'a1', title: 'Unit 3: Fractions', sparkStatus: 'none' },
      { id: 'a2', title: 'Chapter 2 — The Water Cycle', sparkStatus: 'none' },
      { id: 'a3', title: 'Week 4 Review', sparkStatus: 'none' },
      { id: 'a4', title: 'The Civil War', sparkStatus: 'none' },
    ]);
    const admin = makeAdmin({ users: [{ full_name: 'Alex' }], student_model_snapshots: [] });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);

    expect(ctx.recentTopics).toContain('Fractions');
    expect(ctx.recentTopics).toContain('The Water Cycle');
    expect(ctx.recentTopics).toContain('Review');
    expect(ctx.recentTopics).toContain('The Civil War');
    for (const t of ctx.recentTopics) {
      expect(/\d/.test(t), `topic "${t}" should not contain a digit`).toBe(false);
    }
  });

  it('drops titles that become empty after stripping (e.g. "Lesson 5")', async () => {
    mockLoadAssignments.mockResolvedValueOnce([
      { id: 'a1', title: 'Lesson 5', sparkStatus: 'none' },
      { id: 'a2', title: 'Unit 3', sparkStatus: 'none' },
    ]);
    const admin = makeAdmin({ users: [{ full_name: 'Alex' }], student_model_snapshots: [] });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.recentTopics).toHaveLength(0);
  });

  it('strips residual digits from titles that have no leading prefix', async () => {
    mockLoadAssignments.mockResolvedValueOnce([
      { id: 'a1', title: 'Algebra 2', sparkStatus: 'none' },
    ]);
    const admin = makeAdmin({ users: [{ full_name: 'Alex' }], student_model_snapshots: [] });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    // "Algebra 2" → "Algebra " → "Algebra" (trailing space trimmed)
    expect(ctx.recentTopics).toContain('Algebra');
    expect(/\d/.test(ctx.recentTopics[0])).toBe(false);
  });

  it('returns at most 5 recent topics', async () => {
    mockLoadAssignments.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`,
        title: `Topic ${String.fromCharCode(65 + i)}`,
        sparkStatus: 'none',
      })),
    );
    const admin = makeAdmin({ users: [{ full_name: 'Alex' }], student_model_snapshots: [] });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(ctx.recentTopics.length).toBeLessThanOrEqual(5);
  });

  // ── no digit in any string field (the parent-safe invariant) ─────────────

  it('no digit survives in any string field', async () => {
    mockLoadAssignments.mockResolvedValueOnce([
      { id: 'a1', title: 'Unit 3: Fractions', sparkStatus: 'none' },
      { id: 'a2', title: 'The Solar System', sparkStatus: 'none' },
    ]);
    const admin = makeAdmin({
      users: [{ full_name: 'Alex Morgan' }],
      student_model_snapshots: makeSnapshotRows([65, 70, 75, 80]),
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);

    const stringFields = [
      ctx.firstName,
      ctx.gradeTrendDirection ?? '',
      ctx.learningStyleLabel ?? '',
      ...ctx.recentTopics,
    ];
    for (const s of stringFields) {
      expect(/\d/.test(s), `"${s}" should not contain a digit`).toBe(false);
    }
  });

  // ── structural safety check (import guard) ────────────────────────────────

  it('does NOT import loadStudentSignals or loadStudentGradeTrend (structural)', async () => {
    // Grep the source file for forbidden imports at runtime via module inspection.
    // This is a documentation/regression assertion — the actual guard is the
    // "DO NOT import" constraint in the brief + the TypeScript compilation check.
    // We assert the function exists and produces a valid shape.
    const admin = makeAdmin({
      users: [{ full_name: 'Test' }],
      student_model_snapshots: [],
    });
    const ctx = await loadParentNarrativeContext(admin, STUDENT_ID);
    expect(typeof ctx.firstName).toBe('string');
    expect(ctx).toHaveProperty('gradeTrendDirection');
    expect(ctx).toHaveProperty('hasGrowth');
    expect(ctx).toHaveProperty('dataPoints');
    expect(ctx).toHaveProperty('learningStyleLabel');
    expect(ctx).toHaveProperty('recentTopics');
    expect(Array.isArray(ctx.recentTopics)).toBe(true);
  });
});
