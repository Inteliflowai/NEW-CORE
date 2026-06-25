// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createCourseWork = vi.fn();
const createCourseWorkMaterial = vi.fn();
vi.mock('@/lib/google/classroom', () => ({
  createCourseWork: (...a: unknown[]) => createCourseWork(...a),
  createCourseWorkMaterial: (...a: unknown[]) => createCourseWorkMaterial(...a),
}));

import { publishToClassroom, type PublishArgs } from '@/lib/google/publishToClassroom';

// table-dispatching admin mock
// Tracks: publications (rows in google_publications)
// Supports:
//   - from('google_publications').select(...).eq(...).maybeSingle()   → for idempotent checks
//   - from('google_publications').upsert(row, opts)                   → publication insert
//   - from('google_publications').insert(row)                         → course_link insert
// `existingPub`   → a row to return when checking for the resource publication
// `existingLink`  → a row to return when checking for the course_link
// `linkInsertError` → error to return on the course_link insert (e.g., 23505)

function fakeAdmin(opts: {
  existingPub?: { google_coursework_id: string } | null;
  existingLink?: { id: string } | null;
  linkInsertError?: { code?: string; message: string } | null;
}) {
  const upserts: unknown[] = [];
  const inserts: unknown[] = [];

  return {
    upserts,
    inserts,
    from(table: string) {
      if (table === 'google_publications') {
        return {
          select(_cols: string) {
            let seenType: string | undefined;
            let seenCourse: string | undefined;
            let seenSchool: string | undefined;
            let seenResourceType: string | undefined;
            let seenResourceId: string | undefined;

            const chain: {
              eq: (col: string, val: string) => typeof chain;
              maybeSingle: () => Promise<{ data: unknown; error: null }>;
            } = {
              eq(col: string, val: string) {
                if (col === 'resource_type') seenType = val;
                if (col === 'resource_id') seenResourceId = val;
                if (col === 'google_course_id') seenCourse = val;
                if (col === 'school_id') seenSchool = val;
                // Keep track if it's a course_link check (no resource_id eq)
                if (col === 'resource_type' && val === 'course_link') seenResourceType = 'course_link';
                return chain;
              },
              async maybeSingle() {
                // Distinguish course_link check (uses school_id + resource_type='course_link' + google_course_id)
                // from publication check (uses resource_type + resource_id + google_course_id)
                if (seenResourceType === 'course_link' && seenCourse && seenSchool) {
                  return { data: opts.existingLink ?? null, error: null };
                }
                // publication check
                if (seenType && seenResourceId && seenCourse) {
                  return { data: opts.existingPub ?? null, error: null };
                }
                return { data: null, error: null };
              },
            };
            return chain;
          },
          upsert(row: unknown, _opts?: unknown) {
            upserts.push(row);
            return Promise.resolve({ error: null });
          },
          insert(row: unknown) {
            inserts.push(row);
            return Promise.resolve({ error: opts.linkInsertError ?? null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const baseArgs: PublishArgs = {
  token: 'tok',
  schoolId: 'school-1',
  classId: 'class-1',
  googleCourseId: 'course-1',
  resourceType: 'assignment',
  resourceId: 'lesson-abc',
  title: 'Week 3 Essay',
  linkUrl: 'https://core/assignments/lesson-abc',
  courseLinkUrl: 'https://core/class/class-1',
  maxPoints: 80,
  createdBy: 'teacher-uid',
};

beforeEach(() => {
  createCourseWork.mockReset();
  createCourseWorkMaterial.mockReset();
});

describe('publishToClassroom — first publish (assignment)', () => {
  it('creates DRAFT courseWork, pins Open-CORE material, upserts google_publications, returns alreadyPublished:false', async () => {
    createCourseWork.mockResolvedValueOnce({ id: 'cw-001' });
    createCourseWorkMaterial.mockResolvedValueOnce({ id: 'mat-001' });
    const admin = fakeAdmin({ existingPub: null, existingLink: null });

    const result = await publishToClassroom(admin as never, baseArgs);

    expect(result.google_coursework_id).toBe('cw-001');
    expect(result.alreadyPublished).toBe(false);
    expect(result.courseLinkPinned).toBe(true);

    // createCourseWork called with correct args
    expect(createCourseWork).toHaveBeenCalledOnce();
    const [, , cwArgs] = createCourseWork.mock.calls[0];
    expect(cwArgs.title).toBe('Week 3 Essay');
    expect(cwArgs.linkUrl).toBe('https://core/assignments/lesson-abc');
    expect(cwArgs.maxPoints).toBe(80);

    // upsert stores grade_passback_enabled:true for assignments + created_by
    expect(admin.upserts).toHaveLength(1);
    const upserted = admin.upserts[0] as Record<string, unknown>;
    expect(upserted.grade_passback_enabled).toBe(true);
    expect(upserted.created_by).toBe('teacher-uid');
    expect(upserted.resource_id).toBe('lesson-abc');

    // createCourseWorkMaterial called for the Open-CORE pin
    expect(createCourseWorkMaterial).toHaveBeenCalledOnce();
    const [, , matArgs] = createCourseWorkMaterial.mock.calls[0];
    expect(matArgs.title).toBe('Open in CORE');
    expect(matArgs.linkUrl).toBe('https://core/class/class-1');

    // course_link insert uses classId as the resource_id sentinel
    expect(admin.inserts).toHaveLength(1);
    const inserted = admin.inserts[0] as Record<string, unknown>;
    expect(inserted.resource_type).toBe('course_link');
    expect(inserted.resource_id).toBe('class-1');
    expect(inserted.grade_passback_enabled).toBe(false);
    expect(inserted.created_by).toBe('teacher-uid');
  });
});

describe('publishToClassroom — re-publish (idempotent)', () => {
  it('returns alreadyPublished:true and does NOT call createCourseWork again', async () => {
    const admin = fakeAdmin({
      existingPub: { google_coursework_id: 'cw-already' },
      existingLink: { id: 'mat-already' },
    });

    const result = await publishToClassroom(admin as never, baseArgs);

    expect(result.google_coursework_id).toBe('cw-already');
    expect(result.alreadyPublished).toBe(true);
    expect(createCourseWork).not.toHaveBeenCalled();
    expect(admin.upserts).toHaveLength(0);
  });
});

describe('publishToClassroom — quiz', () => {
  it('sets grade_passback_enabled:false and passes maxPoints:null to createCourseWork', async () => {
    createCourseWork.mockResolvedValueOnce({ id: 'cw-quiz' });
    createCourseWorkMaterial.mockResolvedValueOnce({ id: 'mat-quiz' });
    const admin = fakeAdmin({ existingPub: null, existingLink: null });

    const quizArgs: PublishArgs = {
      ...baseArgs,
      resourceType: 'quiz',
      resourceId: 'quiz-xyz',
      maxPoints: undefined,
    };
    const result = await publishToClassroom(admin as never, quizArgs);

    expect(result.alreadyPublished).toBe(false);
    expect(result.google_coursework_id).toBe('cw-quiz');

    const upserted = admin.upserts[0] as Record<string, unknown>;
    expect(upserted.grade_passback_enabled).toBe(false);

    // createCourseWork receives null maxPoints for quizzes
    const [, , cwArgs] = createCourseWork.mock.calls[0];
    expect(cwArgs.maxPoints).toBeNull();
  });
});

describe('publishToClassroom — course_link already pinned (idempotent)', () => {
  it('skips createCourseWorkMaterial when course_link already exists, courseLinkPinned:false', async () => {
    createCourseWork.mockResolvedValueOnce({ id: 'cw-002' });
    const admin = fakeAdmin({
      existingPub: null,
      existingLink: { id: 'mat-existing' }, // already pinned
    });

    const result = await publishToClassroom(admin as never, baseArgs);

    expect(result.alreadyPublished).toBe(false);
    expect(result.courseLinkPinned).toBe(false); // was already there, not newly pinned
    expect(createCourseWorkMaterial).not.toHaveBeenCalled();
  });
});

describe('publishToClassroom — 23505 on course_link insert (concurrent first-publish)', () => {
  it('tolerates a 23505 duplicate error on the link insert and does NOT throw', async () => {
    createCourseWork.mockResolvedValueOnce({ id: 'cw-003' });
    createCourseWorkMaterial.mockResolvedValueOnce({ id: 'mat-race' });
    const admin = fakeAdmin({
      existingPub: null,
      existingLink: null, // SELECT shows nothing (race: another concurrent publish beat us)
      linkInsertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const result = await publishToClassroom(admin as never, baseArgs);

    expect(result.alreadyPublished).toBe(false);
    expect(result.google_coursework_id).toBe('cw-003');
    // 23505 → treated as already-pinned; courseLinkPinned reports false (we didn't do it)
    expect(result.courseLinkPinned).toBe(false);
    // Should NOT throw
  });
});
