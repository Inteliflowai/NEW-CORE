/**
 * scripts/resetDemo.ts
 *
 * Resets the CORE v2 demo seed:
 *  1. Deletes the demo school row (cascades all FK-linked rows).
 *  2. Deletes the demo auth users by email (paginated listUsers — getUserByEmail
 *     does NOT exist).
 *
 * SECURITY:
 *  - Never deletes platform_admin users.
 *  - Never logs secrets.
 *  - Scoped strictly to @demo.coreedtech.com emails.
 *
 * Run: npm run seed:demo:reset
 */

import { createClient } from '@supabase/supabase-js';
import {
  DEMO_STUDENTS,
  DEMO_TEACHER,
  DEMO_PARENT,
  DEMO_ADMIN,
  DEMO_SCHOOL_NAME,
} from '../src/lib/demo/demoCast';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

/** Paginate listUsers to resolve an auth id by email (getUserByEmail does NOT exist). */
async function findAuthIdByEmail(email: string): Promise<string | null> {
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

async function main() {
  // ── Step 1: Delete the demo school (cascades FK rows) ─────────────────────
  console.log('[reset] Looking up demo school…');
  const { data: school } = await admin
    .from('schools')
    .select('id')
    .eq('name', DEMO_SCHOOL_NAME)
    .eq('demo_mode', true)
    .maybeSingle();

  if (school) {
    const { error } = await admin
      .from('schools')
      .delete()
      .eq('id', school.id);
    if (error) {
      console.error('[reset] Failed to delete demo school:', error.message);
    } else {
      console.log(`[reset] Deleted school ${school.id} (cascade complete)`);
    }
  } else {
    console.log('[reset] No demo school found — skipping school delete');
  }

  // ── Step 2: Delete demo auth users ────────────────────────────────────────
  const demoEmails = [
    `${DEMO_TEACHER.key}@demo.coreedtech.com`,
    `${DEMO_PARENT.key}@demo.coreedtech.com`,
    `${DEMO_ADMIN.key}@demo.coreedtech.com`,
    ...DEMO_STUDENTS.map(s => `${s.key}@demo.coreedtech.com`),
  ];

  for (const email of demoEmails) {
    try {
      const id = await findAuthIdByEmail(email);
      if (!id) {
        console.log(`[reset] Auth user not found: ${email}`);
        continue;
      }

      // Safety check — never delete platform_admin
      const { data: profile } = await admin
        .from('users')
        .select('role')
        .eq('id', id)
        .maybeSingle();

      if (profile?.role === 'platform_admin') {
        console.warn(`[reset] Refusing to delete platform_admin user ${email} — skipping`);
        continue;
      }

      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.warn(`[reset] Failed to delete auth user ${email} (soft):`, error.message);
      } else {
        console.log(`[reset] Deleted auth user ${email} (${id})`);
      }
    } catch (e) {
      console.warn(`[reset] Error deleting ${email} (soft):`, (e as Error).message);
    }
  }

  console.log('[reset] Demo reset complete.');
}

main().catch(err => {
  console.error('[reset] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
