import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureAuthUser = vi.fn();
vi.mock('@/lib/trial/ensureAuthUser', () => ({
  ensureAuthUser: (...a: unknown[]) => ensureAuthUser(...a),
}));
vi.mock('@/lib/trial/generatePassword', () => ({ generateTrialPassword: () => 'TestPass#0001' }));

// fake admin: external_identities google-row lookup + users email lookup + identity upsert capture.
function fakeAdmin(opts: {
  idRow?: { core_student_id: string } | null;       // existing google identity row
  userRows?: Array<{ id: string; role: string }>;   // public.users email matches
}) {
  const upserts: Array<Record<string, unknown>> = [];
  let call = 0;
  return {
    upserts,
    from(table: string) {
      if (table === 'external_identities') {
        return {
          select() {
            return { eq() { return this; }, maybeSingle: async () => ({ data: opts.idRow ?? null, error: null }) };
          },
          upsert(row: Record<string, unknown>, o?: { onConflict?: string }) {
            upserts.push({ ...row, __onConflict: o?.onConflict }); return Promise.resolve({ error: null });
          },
        };
      }
      // users email lookup: select().eq(school).eq('email', lower) -> rows
      return {
        select() {
          const chain = {
            eq() { return chain; },
            then(resolve: (v: { data: unknown; error: null }) => unknown) {
              return resolve({ data: opts.userRows ?? [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

beforeEach(() => { ensureAuthUser.mockReset(); });

describe('linkOrCreateStudent', () => {
  it('skips a student with no email', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({}) as never, { schoolId: 's1', googleId: 'g1', email: '', name: 'X' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'no_email' });
  });
  it('links via an existing google identity row (no create)', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: { core_student_id: 'stu7' } }) as never, { schoolId: 's1', googleId: 'g1', email: 'a@b.edu', name: 'A' });
    expect(r).toEqual({ outcome: 'linked', studentId: 'stu7' });
    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
  it('reuses exactly one existing student matched by email and writes the identity row', async () => {
    const admin = fakeAdmin({ idRow: null, userRows: [{ id: 'stu3', role: 'student' }] });
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(admin as never, { schoolId: 's1', googleId: 'g1', email: 'A@B.edu', name: 'A' });
    expect(r).toEqual({ outcome: 'linked', studentId: 'stu3' });
    const row = admin.upserts[0];
    expect(row.provider).toBe('google');
    expect(row.external_id).toBe('g1');
    expect(row.core_student_id).toBe('stu3');
    expect(row.email).toBe('a@b.edu');            // lowercased
    expect(typeof row.last_seen_at).toBe('string');
    expect(row.__onConflict).toBe('school_id,provider,external_id');
  });
  it('creates a new student via ensureAuthUser when no match', async () => {
    ensureAuthUser.mockResolvedValue('newStu');
    const admin = fakeAdmin({ idRow: null, userRows: [] });
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(admin as never, { schoolId: 's1', googleId: 'g1', email: 'new@b.edu', name: 'New' });
    expect(r).toEqual({ outcome: 'created', studentId: 'newStu' });
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'student', email: 'new@b.edu', school_id: 's1', password: 'TestPass#0001' }));
    expect(admin.upserts[0].core_student_id).toBe('newStu');
  });
  it('skips ambiguous when more than one student matches the email', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [{ id: 'a', role: 'student' }, { id: 'b', role: 'student' }] }) as never, { schoolId: 's1', googleId: 'g1', email: 'dup@b.edu', name: 'D' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'ambiguous' });
    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
  it('skips rebind_refused when the matched email belongs to a non-student role', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [{ id: 't1', role: 'teacher' }] }) as never, { schoolId: 's1', googleId: 'g1', email: 'teach@b.edu', name: 'T' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'rebind_refused' });
  });
  it('skips rebind_refused when the email matches BOTH a student AND a non-student (IMP-5 collision)', async () => {
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    // one student + one teacher share the email — the non-student collision must win (skip+flag),
    // never reuse the student row.
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [{ id: 's3', role: 'student' }, { id: 't1', role: 'teacher' }] }) as never, { schoolId: 's1', googleId: 'g1', email: 'shared@b.edu', name: 'S' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'rebind_refused' });
    expect(ensureAuthUser).not.toHaveBeenCalled();
  });
  it('catches an ensureAuthUser rebind throw and skips rebind_refused (never aborts)', async () => {
    ensureAuthUser.mockRejectedValue(new Error('Refusing to rebind existing user (role/school mismatch) — not seed-owned'));
    const { linkOrCreateStudent } = await import('@/lib/google/linkOrCreateStudent');
    const r = await linkOrCreateStudent(fakeAdmin({ idRow: null, userRows: [] }) as never, { schoolId: 's1', googleId: 'g1', email: 'x@b.edu', name: 'X' });
    expect(r).toEqual({ outcome: 'skipped', reason: 'rebind_refused' });
  });
});
