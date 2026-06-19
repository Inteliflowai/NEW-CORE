/**
 * scripts/seedPlatformAdmin.ts
 *
 * Creates (or reconciles) a single platform_admin (super-admin) account in the
 * project pointed at by .env.local. platform_admin is a GLOBAL role — school_id
 * is null — so it is intentionally NOT created by the demo/trial seeders (C14).
 *
 * Reads SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL from env (loaded via
 * `node --env-file=.env.local`), and the target account from:
 *   PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD, PLATFORM_ADMIN_NAME (optional)
 * The password is NEVER hardcoded here and never logged.
 *
 * SECURITY:
 *  - Reconciles by AUTH ID (createUser; on "already exists" → paginate listUsers).
 *  - Idempotent: re-running updates the password + ensures the public.users row.
 *
 * Run: PLATFORM_ADMIN_EMAIL=you@x.com PLATFORM_ADMIN_PASSWORD='...' \
 *        node --env-file=.env.local --import tsx scripts/seedPlatformAdmin.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const EMAIL = process.env.PLATFORM_ADMIN_EMAIL;
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD;
const NAME = process.env.PLATFORM_ADMIN_NAME ?? 'Platform Admin';

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('Missing PLATFORM_ADMIN_EMAIL or PLATFORM_ADMIN_PASSWORD in environment.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const email = EMAIL!;
  const password = PASSWORD!;

  console.log(`[admin] Ensuring platform_admin for ${email}…`);

  // 1. Resolve auth identity (by id, never trust email as a unique key).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: NAME },
  });
  let id = created?.user?.id ?? null;

  if (!id) {
    if (createErr && /already|exist|registered/i.test(createErr.message)) {
      id = await findAuthIdByEmail(email);
      if (id) {
        // Reset the password so the operator's chosen password is authoritative.
        const { error: updErr } = await admin.auth.admin.updateUserById(id, { password });
        if (updErr) throw updErr;
        console.log('[admin] Reused existing auth user; password reset.');
      }
    }
    if (!id) throw createErr ?? new Error(`Could not ensure auth user ${email}`);
  } else {
    console.log('[admin] Created new auth user.');
  }

  // 2. Upsert the public.users row as platform_admin (global — school_id null).
  const { data: existing } = await admin
    .from('users')
    .select('id, role, school_id')
    .eq('id', id)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await admin
      .from('users')
      .update({ role: 'platform_admin', full_name: NAME, email })
      .eq('id', id);
    if (updErr) throw updErr;
    console.log(`[admin] Updated public.users row → platform_admin (id ${id}).`);
  } else {
    const { error: insErr } = await admin
      .from('users')
      .insert({ id, email, full_name: NAME, role: 'platform_admin', school_id: null });
    if (insErr) throw insErr;
    console.log(`[admin] Inserted public.users row → platform_admin (id ${id}).`);
  }

  console.log('[admin] Done. platform_admin ready:', email);
}

main().catch((e) => {
  console.error('[admin] FAILED:', (e as Error).message);
  process.exit(1);
});
