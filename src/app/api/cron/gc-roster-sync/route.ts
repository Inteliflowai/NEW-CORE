// POST /api/cron/gc-roster-sync — nightly Vercel Cron (vercel.json). Iterates every google_connection
// (stably ordered by connected_at so coverage rotates) and reconciles each teacher's GC-mirrored
// classes via the shared engine. CRON_SECRET-gated, TIMING-SAFE + DUAL-ACCEPT (Authorization: Bearer
// OR x-cron-secret — robust to whichever header the platform sends). PER-TEACHER & per-class
// isolation: a revoked/scope-missing/refresh-failed grant is flagged for reconnect (with a reason)
// and that teacher's remaining classes are skipped (break); any other error increments `errors` and
// CONTINUES — one bad token never aborts the sweep. Bounded by a wall-clock budget under maxDuration.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

// Vercel allows up to 300s; this is the warranted exception to the global "don't add runtime" rule
// (the voice routes already set maxDuration). Bounds a large multi-school nightly sweep (MIN-2).
export const maxDuration = 300;
const BUDGET_MS = 270_000;   // stop cleanly before the platform hard-kills at maxDuration

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type ReconnectReason = 'not_connected' | 'scope' | 'refresh_failed';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  // Dual-accept: Authorization: Bearer <secret> (Vercel Cron default) OR x-cron-secret (repo pattern).
  const presented = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.headers.get('x-cron-secret') ?? '';
  if (!secret || !safeEq(presented, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const { data: conns } = await admin.from('google_connections').select('user_id, school_id').order('connected_at', { ascending: true });
  const connections = (conns as Array<{ user_id: string; school_id: string | null }> | null) ?? [];

  let classesSeen = 0;
  let reconciled = 0;
  let errors = 0;
  let truncated = false;
  let processed = 0;   // connections fully processed (for the remaining count)
  const flaggedReconnect: Array<{ teacherId: string; reason: ReconnectReason }> = [];
  const startedAt = Date.now();

  for (const conn of connections) {
    if (Date.now() - startedAt > BUDGET_MS) {
      truncated = true;
      console.warn('[gc-cron] wall-clock budget reached — truncating; remaining connections:', connections.length - processed);
      break;
    }
    processed++;
    if (!conn.school_id) continue;   // a connection with no school cannot mint/scope students
    // Select the class's OWN school_id and pass IT to the engine (IMP-7 — the class is the tenant
    // authority, not the connection).
    const { data: cls } = await admin
      .from('classes')
      .select('id, google_course_id, school_id')
      .eq('teacher_id', conn.user_id)
      .not('google_course_id', 'is', null);
    const classes = (cls as Array<{ id: string; google_course_id: string; school_id: string | null }> | null) ?? [];
    for (const c of classes) {
      if (!c.school_id) continue;
      classesSeen++;
      try {
        await reconcileCourseRoster(admin, {
          teacherId: conn.user_id, schoolId: c.school_id,
          googleCourseId: c.google_course_id, classId: c.id,
        });
        reconciled++;
      } catch (err) {
        const reason = reconnectReason(err);
        if (reason) {
          flaggedReconnect.push({ teacherId: conn.user_id, reason });
          console.warn('[gc-cron] connection needs reconnect (skipped):', conn.user_id, reason);
          break;   // skip the rest of THIS teacher's classes — their grant is the problem
        }
        errors++;
        console.error('[gc-cron] class reconcile failed (continuing):', c.id, err instanceof Error ? err.message : 'unknown');
      }
    }
  }

  return NextResponse.json({
    ok: true, teachers: connections.length, classes: classesSeen, reconciled,
    flaggedReconnect, errors, truncated, remaining: connections.length - processed,
  });
}

// Classify a grant-level failure (flag-for-reconnect + break) vs a transient error (count + continue).
// A token-refresh HTTP failure throws a PLAIN Error('google token refresh failed: <status>') from the
// Seg-1 token manager — it is grant-level too (IMP-10), not a generic error.
function reconnectReason(err: unknown): ReconnectReason | null {
  if (err instanceof GoogleNotConnectedError) return 'not_connected';
  if (err instanceof GoogleScopeError) return 'scope';
  if (err instanceof Error && /token refresh failed/i.test(err.message)) return 'refresh_failed';
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
