import { describe, it, expect } from 'vitest';

// A tiny query-recording fake admin. external_id path uses .eq(...).eq(...).eq(...).maybeSingle();
// the email path uses .eq(school).eq(provider).eq(lower? ) — we model it as a filtered select that
// returns rows the test supplies.
function fakeAdmin(opts: {
  byExternalId?: { core_student_id: string } | null;
  byEmailRows?: Array<{ core_student_id: string; external_id?: string | null }>;
}) {
  return {
    from() {
      return {
        select() {
          const chain = {
            _eqs: [] as Array<[string, unknown]>,
            eq(col: string, val: unknown) { this._eqs.push([col, val]); return chain; },
            maybeSingle: async () => ({ data: opts.byExternalId ?? null, error: null }),
            // the email path: chained .eq() filters (incl. .eq('email', lower)) then a plain await
            then(resolve: (v: { data: unknown; error: null }) => unknown) {
              return resolve({ data: opts.byEmailRows ?? [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

describe('resolveExternalIdentity', () => {
  it('returns core_student_id on an external_id hit (write-free)', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: { core_student_id: 'stu1' } }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'g1', email: 'a@b.edu',
    });
    expect(out).toBe('stu1');
  });
  it('falls back to an unambiguous email match when no external_id row', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: null, byEmailRows: [{ core_student_id: 'stu9' }] }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'gX', email: 'A@B.edu',
    });
    expect(out).toBe('stu9');
  });
  it('returns null when email matches more than one distinct student (ambiguous)', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: null, byEmailRows: [{ core_student_id: 'a' }, { core_student_id: 'b' }] }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'gX', email: 'dup@b.edu',
    });
    expect(out).toBeNull();
  });
  it('returns null when neither id nor email resolves', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(fakeAdmin({ byExternalId: null, byEmailRows: [] }) as never, {
      schoolId: 's1', provider: 'google', externalId: 'gX', email: null,
    });
    expect(out).toBeNull();
  });
  // Regression (whole-branch review): email match must NOT override a row already linked to a
  // different Google id — recycled/reassigned school email account-takeover guard.
  it('email fallback returns null when the matched row is linked to a DIFFERENT Google id', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(
      fakeAdmin({ byExternalId: null, byEmailRows: [{ core_student_id: 'stu5', external_id: 'G_X' }] }) as never,
      { schoolId: 's1', provider: 'google', externalId: 'G_Y', email: 'e@s.edu' },
    );
    expect(out).toBeNull();
  });
  it('email fallback resolves an UNLINKED row (external_id null) — first-login by email', async () => {
    const { resolveExternalIdentity } = await import('@/lib/google/resolveExternalIdentity');
    const out = await resolveExternalIdentity(
      fakeAdmin({ byExternalId: null, byEmailRows: [{ core_student_id: 'stu5', external_id: null }] }) as never,
      { schoolId: 's1', provider: 'google', externalId: 'G_Y', email: 'e@s.edu' },
    );
    expect(out).toBe('stu5');
  });
});
