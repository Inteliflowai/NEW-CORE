// src/lib/trial/__tests__/ensureAuthUser.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ensureAuthUser } from '../ensureAuthUser';

// ---------------------------------------------------------------------------
// Mock logTrialEvent to track audit calls
// ---------------------------------------------------------------------------
vi.mock('@/lib/trial/logTrialEvent', () => ({
  logTrialEvent: vi.fn(async () => {}),
}));
import { logTrialEvent } from '@/lib/trial/logTrialEvent';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------
function makeCreateUserAdmin(opts: {
  createdId?: string | null;
  errorMsg?: string | null;
}) {
  return {
    createUser: vi.fn(async () => ({
      data: opts.createdId ? { user: { id: opts.createdId } } : null,
      error: opts.errorMsg ? { message: opts.errorMsg } : null,
    })),
    listUsers: vi.fn(async () => ({
      data: { users: [{ id: 'existing-auth-id', email: 'taken@school.com' }] },
      error: null,
    })),
  };
}

/**
 * makeFromAdmin — returns a `from` spy that records which tables had `insert`
 * called on them, allowing test #2 to assert insert was NOT called on `users`.
 *
 * A `insertedTables` array is attached to the returned spy so tests can inspect it.
 */
function makeFromAdmin(existingRow: { id: string; role: string; school_id: string | null } | null) {
  // Shared tracking array — populated whenever insert() is called on any table
  const insertedTables: string[] = [];
  // Shared tracking array — populated whenever update() is called on any table
  const updatedTables: string[] = [];

  const fromSpy = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: existingRow, error: null })),
      })),
    })),
    update: vi.fn(() => {
      updatedTables.push(table);
      return { eq: vi.fn(async () => ({ error: null })) };
    }),
    insert: vi.fn(async () => {
      insertedTables.push(table);
      return { error: null };
    }),
  }));

  // Attach tracking arrays to the spy so tests can read them
  (fromSpy as ReturnType<typeof vi.fn> & {
    insertedTables: string[];
    updatedTables: string[];
  }).insertedTables = insertedTables;
  (fromSpy as ReturnType<typeof vi.fn> & {
    insertedTables: string[];
    updatedTables: string[];
  }).updatedTables = updatedTables;

  return fromSpy as typeof fromSpy & { insertedTables: string[]; updatedTables: string[] };
}

describe('ensureAuthUser', () => {
  it('inserts public.users row only for a genuinely new auth user', async () => {
    const fromMock = makeFromAdmin(null); // no existing public row
    const admin = {
      auth: { admin: makeCreateUserAdmin({ createdId: 'new-uuid-1' }) },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const id = await ensureAuthUser({
      admin,
      email: 'new@school.com',
      password: 'pw',
      full_name: 'New User',
      role: 'teacher',
      school_id: 'school-1',
    });

    expect(id).toBe('new-uuid-1');
    // insert was called on the users table (new user path)
    expect(fromMock.insertedTables).toContain('users');
  });

  it('does NOT insert public.users row for an already-existing auth user', async () => {
    // createUser returns error (already exists), findAuthIdByEmail resolves the id
    const fromMock = makeFromAdmin({
      id: 'existing-auth-id',
      role: 'teacher',
      school_id: 'school-1',
    });
    const admin = {
      auth: {
        admin: makeCreateUserAdmin({
          createdId: null,
          errorMsg: 'User already registered',
        }),
      },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const id = await ensureAuthUser({
      admin,
      email: 'taken@school.com',
      password: 'pw',
      full_name: 'Taken User',
      role: 'teacher',
      school_id: 'school-1',
    });

    expect(id).toBe('existing-auth-id');

    // REAL assertion: insert must NOT have been called on the `users` table
    expect(fromMock.insertedTables).not.toContain('users');

    // AND update WAS called (reconcile path updates full_name)
    expect(fromMock.updatedTables).toContain('users');
  });

  it('throws on role mismatch when existing.school_id matches requested school_id', async () => {
    const fromMock = makeFromAdmin({
      id: 'existing-auth-id',
      role: 'student', // ← wrong role
      school_id: 'school-1',
    });
    const admin = {
      auth: {
        admin: makeCreateUserAdmin({ createdId: null, errorMsg: 'User already registered' }),
      },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(
      ensureAuthUser({
        admin,
        email: 'taken@school.com',
        password: 'pw',
        full_name: 'Role Mismatch',
        role: 'teacher',
        school_id: 'school-1',
      })
    ).rejects.toThrow(/rebind|mismatch/i);
  });

  it('calls logTrialEvent before throwing on role/school mismatch', async () => {
    vi.mocked(logTrialEvent).mockClear();
    const fromMock = makeFromAdmin({
      id: 'existing-auth-id',
      role: 'student',
      school_id: 'school-1',
    });
    const admin = {
      auth: {
        admin: makeCreateUserAdmin({ createdId: null, errorMsg: 'User already registered' }),
      },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(
      ensureAuthUser({
        admin,
        email: 'taken@school.com',
        password: 'pw',
        full_name: 'Role Mismatch',
        role: 'teacher',
        school_id: 'school-1',
      })
    ).rejects.toThrow();

    expect(logTrialEvent).toHaveBeenCalledOnce();
    const call = vi.mocked(logTrialEvent).mock.calls[0][0];
    expect(call.eventType).toBe('trial_signup');
    expect(call.metadata).toMatchObject({
      audit_action: 'rebind_refused',
      email: 'taken@school.com',
      requested_role: 'teacher',
    });
  });

  it('throws on school_id mismatch even when existing.school_id is null', async () => {
    // null school_id on existing row must no longer be accepted as seed-owned
    const fromMock = makeFromAdmin({
      id: 'existing-auth-id',
      role: 'teacher',
      school_id: null, // ← null — should NOT be treated as a match
    });
    const admin = {
      auth: {
        admin: makeCreateUserAdmin({ createdId: null, errorMsg: 'User already registered' }),
      },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(
      ensureAuthUser({
        admin,
        email: 'taken@school.com',
        password: 'pw',
        full_name: 'Null School',
        role: 'teacher',
        school_id: 'school-1',
      })
    ).rejects.toThrow(/rebind|mismatch/i);
  });

  it('throws and refuses to INSERT when createUser errors "already exists" but no public.users row exists (orphaned auth user)', async () => {
    // Setup: createUser returns "already registered" → findAuthIdByEmail resolves a
    // FOREIGN auth id. No public.users row exists for that id (makeFromAdmin(null)).
    // This is the orphaned-auth-user path: !isNewAuthUser && !existing → must throw,
    // must NOT insert a public.users row.
    const fromMock = makeFromAdmin(null); // no existing public row
    const admin = {
      auth: {
        admin: makeCreateUserAdmin({
          createdId: null,
          errorMsg: 'User already registered',
        }),
      },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    // Must throw with a message about manual remediation / no public row
    await expect(
      ensureAuthUser({
        admin,
        email: 'taken@school.com',
        password: 'pw',
        full_name: 'Orphaned User',
        role: 'teacher',
        school_id: 'school-1',
      })
    ).rejects.toThrow(/manual remediation|no public|remediation/i);

    // Must NEVER have called insert on the users table
    expect(fromMock.insertedTables).not.toContain('users');
  });

  it('rolls back the created auth user when the public.users insert fails (C2)', async () => {
    const deleteUser = vi.fn(async () => ({ error: null }));
    const fromMock = vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      insert: vi.fn(async () => ({ error: { message: 'insert boom' } })), // returns {error}
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    }));
    const admin = {
      auth: { admin: {
        createUser: vi.fn(async () => ({ data: { user: { id: 'new-auth-1' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
        deleteUser,
      } },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(ensureAuthUser({
      admin, email: 'new@school.com', password: 'pw', full_name: 'New', role: 'teacher', school_id: 'school-1',
    })).rejects.toThrow(/insert boom/i);
    expect(deleteUser).toHaveBeenCalledWith('new-auth-1'); // orphan rolled back
  });

  it('rebind_refused audit is logged with a null schoolId so it survives school-delete cascade (C3)', async () => {
    vi.mocked(logTrialEvent).mockClear();
    const fromMock = makeFromAdmin({ id: 'existing-auth-id', role: 'student', school_id: 'school-1' });
    const admin = {
      auth: { admin: makeCreateUserAdmin({ createdId: null, errorMsg: 'User already registered' }) },
      from: fromMock,
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(ensureAuthUser({
      admin, email: 'taken@school.com', password: 'pw', full_name: 'X', role: 'teacher', school_id: 'school-1',
    })).rejects.toThrow();

    const call = vi.mocked(logTrialEvent).mock.calls[0][0];
    expect(call.schoolId).toBeNull();                          // durable: not tied to the soon-deleted school
    expect(call.metadata).toMatchObject({ audit_action: 'rebind_refused', requested_school_id: 'school-1' });
  });
});
