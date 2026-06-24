// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getValid = vi.fn();
const listCourseStudents = vi.fn();
const linkOrCreateStudent = vi.fn();
vi.mock('@/lib/google/tokens', () => ({ getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a) }));
vi.mock('@/lib/google/classroom', () => ({ listCourseStudents: (...a: unknown[]) => listCourseStudents(...a) }));
vi.mock('@/lib/google/linkOrCreateStudent', () => ({ linkOrCreateStudent: (...a: unknown[]) => linkOrCreateStudent(...a) }));

// fake admin. Models, per (class_id) scope:
//  - the prior-seat read:  enrollments.select('is_active, source').eq(class_id).eq(student_id).maybeSingle()
//  - the enroll upsert:     enrollments.upsert(row, {onConflict}) -> { error }
//  - the source='google' active-seat set: enrollments.select('student_id')
//       .eq(class_id).eq(is_active,true).eq(source,'google')
//       then external_identities.select('core_student_id, external_id').in(chunk) for the IDs
//       (LEFT-join semantics: seats with no identity row get external_id=undefined)
//  - the soft-un-enroll:    enrollments.update({is_active:false}).eq(class_id).eq(student_id) -> { error }
// `googleSeats` supplies [{ student_id, external_id }] — THIS class's active source='google' seats.
//   external_id may be undefined to simulate an orphaned seat with no external_identities row (IMP-4).
// `priorSeat` supplies { is_active, source? } per student_id. source defaults to 'google' when omitted
//   so existing tests that don't set source still see the 'google' provenance path.
// `seatsReadError` lets a test simulate the enrollments candidate-set read failing (must NOT be
// treated as "empty" — the engine should skip the remove side and flag removeSkippedSuspectEmpty).
function fakeAdmin(opts: {
  googleSeats?: Array<{ student_id: string; external_id: string | undefined }>;   // this class's active source='google' seats
  priorSeat?: Record<string, { is_active: boolean; source?: string | null }>;     // prior seat state by student_id (for count split + provenance)
  enrollError?: unknown;                                                           // returned by the enroll upsert
  updateError?: unknown;                                                          // returned by the soft-un-enroll update
  seatsReadError?: unknown;                                                       // returned by the enrollments candidate-set read
}) {
  const enrollUpserts: Array<{ student_id: string; is_active: boolean; source?: string }> = [];
  const softRemovals: string[] = [];
  const priorSeat = opts.priorSeat ?? {};
  const googleSeats = opts.googleSeats ?? [];

  return {
    enrollUpserts, softRemovals,
    from(table: string) {
      if (table === 'enrollments') {
        return {
          upsert(row: { class_id: string; student_id: string; is_active: boolean; source?: string }) {
            if (!opts.enrollError) enrollUpserts.push({ student_id: row.student_id, is_active: row.is_active, source: row.source });
            return Promise.resolve({ error: opts.enrollError ?? null });
          },
          // Two select shapes are distinguished by the selected columns string:
          //  'is_active' (single, may also include 'source') -> the prior-seat read .eq(class_id).eq(student_id).maybeSingle()
          //  'student_id' (candidate set)                    -> THIS class's active source='google' enrollments
          select(cols: string) {
            if (cols.includes('is_active') && !cols.includes('student_id')) {
              // Prior-seat read: .eq(class_id).eq(student_id).maybeSingle()
              // Returns { is_active, source } — source defaults to 'google' when the test doesn't set it,
              // keeping the existing add-side tests unaffected.
              let sawStudent: string | undefined;
              const chain = {
                eq(col: string, val: string) { if (col === 'student_id') sawStudent = val; return chain; },
                maybeSingle: async () => {
                  if (!sawStudent || !priorSeat[sawStudent]) return { data: null, error: null };
                  const p = priorSeat[sawStudent];
                  // Use 'google' as the default only when source was NOT explicitly set on the test fixture.
                  // null is a valid source value (manual seat) and must NOT be coerced to 'google'.
                  const source = 'source' in p ? p.source : 'google';
                  return { data: { is_active: p.is_active, source }, error: null };
                },
              };
              return chain;
            }
            // Candidate-set read: returns the list of active source='google' student_ids for this class.
            // loadActiveGoogleSeats calls this then follows up with external_identities.
            // If seatsReadError is set, signal an error (must NOT be treated as empty).
            return {
              eq() { return this; },
              then(r: (v: { data: unknown; error: unknown }) => unknown) {
                if (opts.seatsReadError) {
                  return r({ data: null, error: opts.seatsReadError });
                }
                const studentRows = googleSeats.map((s) => ({ student_id: s.student_id }));
                return r({ data: studentRows, error: null });
              },
            };
          },
          update(_vals: { is_active: boolean }) {
            return {
              eq(col: string, val: string) {
                if (col === 'student_id' && !opts.updateError) softRemovals.push(val);
                return { eq: () => Promise.resolve({ error: opts.updateError ?? null }) };
              },
            };
          },
        };
      }

      if (table === 'external_identities') {
        // loadActiveGoogleSeats follows up with:
        //   .select('core_student_id, external_id').eq('school_id',...).eq('provider',...).in('core_student_id', chunk)
        // We return the external_id rows for seats that HAVE an external_id. Seats with
        // external_id=undefined simulate orphaned seats (LEFT-join — no row returned for those IDs).
        return {
          select() {
            return {
              eq() { return this; },
              in(_col: string, ids: string[]) {
                return Promise.resolve({
                  data: googleSeats
                    .filter((s) => ids.includes(s.student_id) && s.external_id !== undefined)
                    .map((s) => ({ core_student_id: s.student_id, external_id: s.external_id as string })),
                  error: null,
                });
              },
            };
          },
        };
      }

      // Fallback for any other table
      return {
        select() {
          return {
            eq() { return this; },
            then(r: (v: { data: unknown; error: null }) => unknown) { return r({ data: [], error: null }); },
          };
        },
      };
    },
  } as never as { enrollUpserts: typeof enrollUpserts; softRemovals: typeof softRemovals };
}
// NOTE FOR THE IMPLEMENTER: this fake mirrors the SHAPES the engine touches — the per-student
// prior-seat .eq(class_id).eq(student_id).maybeSingle() read (resolved from priorSeat), the
// {error}-returning enroll upsert + soft-un-enroll update, and the class-scoped source='google'
// candidate select (enrollments → student_ids, then external_identities → external_ids). Keep each
// as a discrete call that branches on the RETURNED { error } (never a try/catch around supabase-js).

beforeEach(() => {
  getValid.mockReset(); listCourseStudents.mockReset(); linkOrCreateStudent.mockReset();
  getValid.mockResolvedValue('AT');
});

describe('reconcileCourseRoster — add side', () => {
  it('creates/links + enrolls each GC student (source=google) and tallies', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
      { googleId: 'g2', name: 'B', email: 'b@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent
      .mockResolvedValueOnce({ outcome: 'created', studentId: 's1' })
      .mockResolvedValueOnce({ outcome: 'linked', studentId: 's2' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });   // no prior seats → both fresh enrolls
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.created).toBe(1); expect(r.linked).toBe(1);
    expect(r.enrolled).toBe(2); expect(r.reactivated).toBe(0); expect(r.errors).toBe(0);
    expect(admin.enrollUpserts.every((e) => e.source === 'google')).toBe(true);
    expect(r.softRemoved).toBe(0);
  });
  it('counts skippedNoEmail and never enrolls a no-email skip', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g3', name: '', email: '', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValueOnce({ outcome: 'skipped', reason: 'no_email' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.skippedNoEmail).toBe(1); expect(r.enrolled).toBe(0);
  });
  it('reactivates a previously soft-removed seat (IMP-3 — counts reactivated, not enrolled)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // prior seat for s1 exists with is_active=false → the upsert reactivates it.
    const admin = fakeAdmin({ googleSeats: [], priorSeat: { s1: { is_active: false } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.reactivated).toBe(1); expect(r.enrolled).toBe(0);
  });
  it('dedupes a duplicate email within one import (IMP-4 — second row skippedOther, not double-enrolled)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'dup@b.edu', photoUrl: null },
      { googleId: 'g2', name: 'A2', email: 'DUP@b.edu', photoUrl: null },   // same email (case-insensitive)
    ] });
    linkOrCreateStudent.mockResolvedValueOnce({ outcome: 'created', studentId: 's1' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(linkOrCreateStudent).toHaveBeenCalledTimes(1);   // second never reaches link/create
    expect(r.skippedOther).toBe(1); expect(r.enrolled).toBe(1);
  });
  it('seat-cap / DB error on the enroll upsert is counted, not silently enrolled (IMP-1)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'created', studentId: 's1' });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {}, enrollError: { code: '23514' } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.enrolled).toBe(0);
    expect(r.errors + r.skippedOther).toBeGreaterThanOrEqual(1);   // accounted, not lost
    expect(admin.enrollUpserts).toHaveLength(0);                   // the upsert did not "succeed"
  });
});

describe('reconcileCourseRoster — two-way remove side', () => {
  it('soft un-enrolls a source=google seat no longer in the GC roster', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // s2 (external_id g2) is an active source='google' seat in THIS class but g2 is no longer present.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual(['s2']);
    expect(r.softRemoved).toBe(1);
  });
  it('NEVER soft-removes a source<>google (manually-added) active seat absent from the roster (ITEM A)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // sManual is active in the class but NOT in the source='google' candidate set → left alone.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }], priorSeat: { s1: { is_active: true } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);   // sManual (source<>'google') untouched
    expect(r.softRemoved).toBe(0);
  });
  it('a failed soft-un-enroll update does NOT increment softRemoved (IMP-2)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } }, updateError: { message: 'boom' } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.softRemoved).toBe(0);
    expect(r.errors).toBeGreaterThanOrEqual(1);
  });
  it('CRIT-2: an INCOMPLETE roster skips the remove side and flags removeSkippedSuspectEmpty', async () => {
    listCourseStudents.mockResolvedValue({ complete: false, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // g2 would look "absent" but the roster is untrustworthy (complete:false) → never remove.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(true);
  });
  it('CRIT-2: an EMPTY roster with existing source=google seats skips the remove side (no mass un-enroll)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [] });   // empty but "complete" (transient-200 vector)
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's1', external_id: 'g1' }, { student_id: 's2', external_id: 'g2' }], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(true);
  });
  it('a genuinely empty class (empty roster, no source=google seats) is a clean no-op, not flagged', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [] });
    const admin = fakeAdmin({ googleSeats: [], priorSeat: {} });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(false);
  });
  it('enrollments candidate-set read error → softRemoved=0, removeSkippedSuspectEmpty=true, no soft-remove attempted', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null }] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // seatsReadError simulates a DB failure on the enrollments candidate-set read.
    // The engine must NOT treat this as "no google seats" (which would skip the remove side silently);
    // instead it must flag removeSkippedSuspectEmpty and perform zero soft-removes.
    const admin = fakeAdmin({ googleSeats: [{ student_id: 's2', external_id: 'g2' }], priorSeat: { s1: { is_active: true } }, seatsReadError: { message: 'connection reset' } });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(true);
    expect(admin.softRemovals).toHaveLength(0);
  });
  it('propagates GoogleNotConnectedError from the token manager', async () => {
    class GoogleNotConnectedError extends Error {}
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const admin = fakeAdmin({});
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    await expect(reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' }))
      .rejects.toBeInstanceOf(GoogleNotConnectedError);
  });
});

describe('reconcileCourseRoster — IMP-1 provenance guard (manual seat clobber)', () => {
  it('a student with a pre-existing manual seat (source NULL) who appears in the GC roster → upsert does NOT set source=google', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    // s1 has a prior active seat with source=null (manual)
    const admin = fakeAdmin({
      googleSeats: [],   // no source='google' candidates — the manual seat is NOT in this set
      priorSeat: { s1: { is_active: true, source: null } },
    });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    // The upsert must NOT include source='google'
    expect(admin.enrollUpserts).toHaveLength(1);
    expect(admin.enrollUpserts[0].source).toBeUndefined();
  });

  it('on a later reconcile where a manual-seat student is absent from the roster, they are NOT soft-removed', async () => {
    // The student is absent from the GC roster this time
    listCourseStudents.mockResolvedValue({ complete: true, students: [] });
    // They have no source='google' seat → never in the candidate set → never soft-removed
    const admin = fakeAdmin({
      googleSeats: [],   // no source='google' active seats
      priorSeat: {},
    });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);
    expect(r.softRemoved).toBe(0);
    expect(r.removeSkippedSuspectEmpty).toBe(false);   // clean no-op: empty roster + no google seats
  });

  it('a student with a prior source=google seat → upsert still stamps source=google (existing behaviour preserved)', async () => {
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    const admin = fakeAdmin({
      googleSeats: [],
      priorSeat: { s1: { is_active: true, source: 'google' } },
    });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.enrollUpserts[0].source).toBe('google');
  });
});

describe('reconcileCourseRoster — IMP-4 orphaned google seat (no external_identities row)', () => {
  it('a source=google seat with NO external_identities row, absent from a trustworthy non-empty roster → IS soft-removed', async () => {
    // The roster contains g1 only; s2 is a source='google' seat with no identity row (external_id=undefined).
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    const admin = fakeAdmin({
      // s2 has external_id=undefined (orphaned — no identity row)
      googleSeats: [
        { student_id: 's1', external_id: 'g1' },
        { student_id: 's2', external_id: undefined },
      ],
      priorSeat: { s1: { is_active: true, source: 'google' } },
    });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toContain('s2');
    expect(r.softRemoved).toBe(1);
  });

  it('manual (source≠google) seat is still never removed even when roster is non-empty and trustworthy', async () => {
    // Roster has g1 only; the candidates set has only s1 (source='google').
    // sManual is active but NOT in the google candidate set → untouched.
    listCourseStudents.mockResolvedValue({ complete: true, students: [
      { googleId: 'g1', name: 'A', email: 'a@b.edu', photoUrl: null },
    ] });
    linkOrCreateStudent.mockResolvedValue({ outcome: 'linked', studentId: 's1' });
    const admin = fakeAdmin({
      googleSeats: [{ student_id: 's1', external_id: 'g1' }],
      priorSeat: { s1: { is_active: true, source: 'google' } },
    });
    const { reconcileCourseRoster } = await import('@/lib/google/reconcileCourseRoster');
    const r = await reconcileCourseRoster(admin as never, { teacherId: 't1', schoolId: 'sch', googleCourseId: 'c1', classId: 'cl1' });
    expect(admin.softRemovals).toEqual([]);
    expect(r.softRemoved).toBe(0);
  });
});
