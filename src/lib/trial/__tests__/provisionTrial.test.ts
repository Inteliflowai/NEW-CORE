import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionTrial } from '../provisionTrial';

// ---------------------------------------------------------------------------
// Minimal stub factory — returns a SupabaseClient-shaped mock
//
// Adaptation notes vs. brief scaffold:
//   - `from()` must handle ALL tables that provisionTrial + ensureAuthUser touch.
//     ensureAuthUser calls: auth.admin.createUser, then from('users').select().eq().maybeSingle()
//     and from('users').insert(). Without mocking 'users', createUser returns an id
//     but maybeSingle() would be undefined → TypeError.
//   - seedTrialDemoData is wrapped in a try/catch (soft-fail) in provisionTrial, so
//     we let it fail silently — no need to mock all its tables.
//   - logTrialEvent(trial_events.insert) is also soft-fail; mock returns {error:null}.
//   - The 'schools' update path (Step 5) returns { error } from .update().eq() —
//     the real Supabase client pattern, NOT a throw — so update().eq() returns {error:null}.
// ---------------------------------------------------------------------------
function makeAdmin(overrides: {
  schoolInsertError?: { message: string } | null;
  licenseUpsertError?: { message: string } | null;
  schoolDeleteError?: { message: string } | null;
  ensureTeacherResult?: string | Error;
} = {}) {
  const {
    schoolInsertError = null,
    licenseUpsertError = null,
    schoolDeleteError = null,
    ensureTeacherResult = 'teacher-uuid-1',
  } = overrides;

  // Track what was stored in trial_credentials
  let storedCredentials: unknown = null;

  const admin = {
    _storedCredentials: () => storedCredentials,
    from: vi.fn((table: string) => ({
      insert: vi.fn((_row: unknown) => {
        if (table === 'schools') return { error: schoolInsertError };
        // users.insert, trial_events.insert, and any other table: succeed silently
        return { error: null };
      }),
      upsert: vi.fn((_row: unknown, _opts?: unknown) => ({
        error: table === 'school_licenses' ? licenseUpsertError : null,
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        if (table === 'schools' && 'trial_credentials' in patch) {
          storedCredentials = patch.trial_credentials;
        }
        return {
          eq: vi.fn(() => ({ error: null })),
        };
      }),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({ error: schoolDeleteError })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    auth: {
      admin: {
        createUser: vi.fn(async (params: { email: string }) => {
          if (
            ensureTeacherResult instanceof Error &&
            params.email.startsWith('teacher')
          ) {
            // throw so ensureAuthUser's error propagates to the try/catch in provisionTrial
            throw ensureTeacherResult;
          }
          // For teacher on error-path: return a user id so we can proceed past teacher
          // For parent/student on both paths: return a unique user id per email
          const id =
            params.email.startsWith('teacher')
              ? typeof ensureTeacherResult === 'string'
                ? ensureTeacherResult
                : 'teacher-uuid-fallback'
              : `user-${params.email.replace(/[^a-z0-9]/g, '-').slice(0, 16)}`;
          return { data: { user: { id } }, error: null };
        }),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return admin;
}

// Deterministic RNG: always returns 0 → "BrightStar#0000"
const deterministicRng = () => 0;

describe('provisionTrial', () => {
  it('stored credentials contain email only — no password field', async () => {
    const admin = makeAdmin();
    const result = await provisionTrial({
      admin,
      schoolName: 'Test School',
      teacherEmail: 'teacher@test.com',
      teacherName: 'Test Teacher',
      rng: deterministicRng,
    });

    // result.credentials should have email but NOT password
    expect(result.credentials.teacher).toHaveProperty('email', 'teacher@test.com');
    expect(result.credentials.teacher).not.toHaveProperty('password');

    // result.password must still exist (surfaced once in API response)
    expect(result.password).toBeTruthy();
    expect(typeof result.password).toBe('string');

    // What was stored in schools.trial_credentials must also be email-only
    const stored = (admin as ReturnType<typeof makeAdmin>)._storedCredentials() as Record<string, unknown>;
    expect(stored).toBeTruthy();
    const teacherStored = (stored as Record<string, Record<string, unknown>>).teacher;
    expect(teacherStored).toHaveProperty('email');
    expect(teacherStored).not.toHaveProperty('password');
  });

  it('cleanupAndThrow re-throws a wrapped error when the school DELETE itself fails', async () => {
    const admin = makeAdmin({
      licenseUpsertError: { message: 'license insert failed' },
      schoolDeleteError: { message: 'delete also failed' },
    });

    await expect(
      provisionTrial({
        admin,
        schoolName: 'Fail School',
        teacherEmail: 'x@fail.com',
        teacherName: 'X',
        rng: deterministicRng,
      })
    ).rejects.toThrow(/cleanup.*failed|delete also failed/i);
  });

  it('cleanupAndThrow throws the original provision error when cleanup succeeds', async () => {
    const admin = makeAdmin({
      licenseUpsertError: { message: 'license insert failed' },
      schoolDeleteError: null,
    });

    await expect(
      provisionTrial({
        admin,
        schoolName: 'Fail School',
        teacherEmail: 'x@fail.com',
        teacherName: 'X',
        rng: deterministicRng,
      })
    ).rejects.toThrow(/provisionTrial.*school_licenses/i);
  });
});
