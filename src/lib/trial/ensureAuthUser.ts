/**
 * src/lib/trial/ensureAuthUser.ts
 *
 * Shared auth-user guard for the demo seed (scripts/seedDemo.ts) AND trial
 * provisioning (src/lib/trial/provisionTrial.ts). Both MUST use this same guard.
 *
 * SECURITY CONTRACT (the account-takeover guard — do not weaken):
 *  - Resolve the auth identity by AUTH ID, never trust email as a unique key
 *    (`auth.admin.getUserByEmail` does NOT exist — C13; paginate listUsers).
 *  - On an existing `public.users` row, update only NON-IDENTITY fields
 *    (`full_name`); NEVER overwrite `role` / `school_id`.
 *  - HARD-FAIL (throw) on a role/school_id mismatch — this prevents an attacker
 *    (or a cross-tenant re-provision) from rebinding an existing account.
 *
 * There is NO DB trigger syncing auth.users → public.users, so the caller must
 * INSERT the public.users row after every createUser (p4b-01-schema §Auth-sync).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Paginate listUsers to resolve an auth id by email (getUserByEmail does NOT exist — C13). */
export async function findAuthIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u: { email?: string; id: string }) =>
      u.email?.toLowerCase() === email.toLowerCase()
    );
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export interface EnsureAuthUserParams {
  admin: SupabaseClient;
  email: string;
  password: string;
  full_name: string;
  role: string;
  school_id: string;
}

/**
 * Reconciles by AUTH ID. Never overwrites role/school_id on existing rows; throws
 * on a role/school mismatch (account-takeover guard). Returns the auth user id.
 */
export async function ensureAuthUser({
  admin,
  email,
  password,
  full_name,
  role,
  school_id,
}: EnsureAuthUserParams): Promise<string> {
  // 1. Resolve auth identity (the only source of truth — email is NOT unique).
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  let id = created?.user?.id ?? null;
  if (!id) {
    if (error && /already|exist|registered/i.test(error.message)) {
      id = await findAuthIdByEmail(admin, email);
    }
    if (!id) throw error ?? new Error(`Could not ensure auth user ${email}`);
  }

  // 2. Reconcile the public.users row by ID. NEVER overwrite role/school_id on a row we didn't create.
  const { data: existing, error: selErr } = await admin
    .from('users')
    .select('id, role, school_id')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    if (existing.role !== role || (existing.school_id && existing.school_id !== school_id)) {
      throw new Error(
        `Refusing to rebind existing user ${email} (role/school mismatch) — not seed-owned`
      );
    }
    await admin.from('users').update({ full_name }).eq('id', id);  // only non-identity fields
  } else {
    const { error: insErr } = await admin
      .from('users')
      .insert({ id, email, full_name, role, school_id });
    if (insErr) throw insErr;
  }
  return id;
}
