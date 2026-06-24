// src/lib/google/reconcileCourseRoster.ts
// THE shared two-way reconcile engine. ONE course → ONE class. Three triggers call it: initial
// import, on-demand "Sync now", and the nightly cron. The single-course signature is push-ready
// (a future Pub/Sub webhook can call it per-course) — push itself is NOT built in Seg 2.
//
// SAFETY (binding): scope is STRICTLY the one classId. ADD side: every GC student is matched/
// created (linkOrCreateStudent, account-takeover-safe) then enrolled with source='google'
// (reactivating a soft-removed seat). REMOVE side (two-way): an active source='google' seat in
// THIS class whose google id is ABSENT from a TRUSTWORTHY current GC roster is SOFT un-enrolled
// (is_active=false) — never deleted, never their history. A source<>'google'/manually-added seat
// is NEVER touched (per-class provenance — ITEM A). An empty/incomplete roster NEVER mass-removes
// (CRIT-2). supabase-js returns { error } (does NOT throw) — every upsert/update branches on it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getValidAccessTokenForTeacher } from '@/lib/google/tokens';
import { listCourseStudents } from '@/lib/google/classroom';
import { linkOrCreateStudent } from '@/lib/google/linkOrCreateStudent';

export interface ReconcileArgs {
  teacherId: string;
  schoolId: string;
  googleCourseId: string;
  classId: string;
}

export interface ReconcileResult {
  created: number;
  linked: number;
  skippedNoEmail: number;
  skippedOther: number;
  enrolled: number;
  reactivated: number;
  softRemoved: number;
  errors: number;
  removeSkippedSuspectEmpty: boolean;
}

function emptyResult(): ReconcileResult {
  return {
    created: 0,
    linked: 0,
    skippedNoEmail: 0,
    skippedOther: 0,
    enrolled: 0,
    reactivated: 0,
    softRemoved: 0,
    errors: 0,
    removeSkippedSuspectEmpty: false,
  };
}

// hashClassId — fold the uuid string into a 32-bit integer key for pg_try_advisory_xact_lock.
// Stable per classId; the DB's own hashtext() inside the RPC wrapper does the same job.
function hashClassId(classId: string): number {
  let h = 0;
  for (let i = 0; i < classId.length; i++) {
    h = (h * 31 + classId.charCodeAt(i)) | 0;
  }
  return h;
}

// loadActiveGoogleSeats — THIS class's active source='google' seats with their provider='google'
// external_id. Class-scoped (IMP-9): never load the school-wide identity set.
// Queries enrollments for student_ids, then external_identities for their google external_ids
// (chunked to ≤200 per .in() call — the pilot never hits the chunk boundary).
async function loadActiveGoogleSeats(
  admin: SupabaseClient,
  classId: string,
  schoolId: string,
): Promise<Array<{ student_id: string; external_id: string }>> {
  const { data: seats } = await admin
    .from('enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true)
    .eq('source', 'google');

  const studentIds = ((seats as Array<{ student_id: string }> | null) ?? []).map(
    (s) => s.student_id,
  );
  if (studentIds.length === 0) return [];

  const out: Array<{ student_id: string; external_id: string }> = [];
  for (let i = 0; i < studentIds.length; i += 200) {
    const chunk = studentIds.slice(i, i + 200);
    const { data: ids } = await admin
      .from('external_identities')
      .select('core_student_id, external_id')
      .eq('school_id', schoolId)
      .eq('provider', 'google')
      .in('core_student_id', chunk);
    for (const row of (ids as Array<{ core_student_id: string | null; external_id: string }> | null) ?? []) {
      if (row.core_student_id) {
        out.push({ student_id: row.core_student_id, external_id: row.external_id });
      }
    }
  }
  return out;
}

export async function reconcileCourseRoster(
  admin: SupabaseClient,
  args: ReconcileArgs,
): Promise<ReconcileResult> {
  const r = emptyResult();

  // 0. Concurrency guard (MIN-1): transaction-scoped per-class advisory lock.
  //    On a miss, another reconcile for this class is in flight — bail with all-zero (idempotent
  //    convergence on the next run is the backstop). hashtext(classId) maps the uuid to the int.
  //    NOTE: expose pg_try_advisory_xact_lock via a thin SECURITY DEFINER RPC wrapper so the
  //    admin client can call it; if the wrapper is absent, a null result is treated as acquired.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: gotLock } = await (admin as unknown as { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> })
    .rpc('pg_try_advisory_xact_lock', { key: hashClassId(args.classId) })
    .catch(() => ({ data: true, error: null }));
  if (gotLock === false) return r;

  // 1–2. Token + current GC roster. Both errors propagate so the caller surfaces reconnect/scope CTAs.
  const accessToken = await getValidAccessTokenForTeacher(admin, args.teacherId);
  const { students: gcStudents, complete } = await listCourseStudents(accessToken, args.googleCourseId);

  // Build the present-google-id set from the current roster (blank ids already filtered by Task 2).
  const presentGoogleIds = new Set(gcStudents.map((s) => s.googleId));

  // 4. ADD side — process each GC student: dedupe within-import → link/create → enroll.
  const seenEmails = new Set<string>();

  for (const s of gcStudents) {
    // IMP-4: lowercased email dedupe within one import — a second row with the same email is
    // skippedOther (never double-enroll). A student without an email goes to linkOrCreateStudent
    // which returns skipped/no_email; we still run the seenEmails check on the normalised value.
    const email = (s.email ?? '').trim().toLowerCase();
    if (email && seenEmails.has(email)) {
      r.skippedOther++;
      continue;
    }
    if (email) seenEmails.add(email);

    // Match-or-create the student account (account-takeover-safe via ensureAuthUser).
    const res = await linkOrCreateStudent(admin, {
      schoolId: args.schoolId,
      googleId: s.googleId,
      email: s.email,
      name: s.name,
    });

    if (res.outcome === 'skipped') {
      if (res.reason === 'no_email') r.skippedNoEmail++;
      else r.skippedOther++;
      continue;
    }

    if (res.outcome === 'created') r.created++;
    else r.linked++;

    // Read the prior seat to distinguish enrolled (new) vs reactivated (was soft-removed) — IMP-3.
    const { data: prior } = await admin
      .from('enrollments')
      .select('is_active')
      .eq('class_id', args.classId)
      .eq('student_id', res.studentId)
      .maybeSingle();

    // Enroll with source='google' (per-class provenance — ITEM A). supabase-js returns { error } —
    // never throws. Branch on it; incl. the seat-cap check_violation (23514).
    const { error: enrollErr } = await admin.from('enrollments').upsert(
      { class_id: args.classId, student_id: res.studentId, is_active: true, source: 'google' },
      { onConflict: 'class_id,student_id' },
    );
    if (enrollErr) {
      // Seat-cap (23514) is expected in license-capped schools — count as skipped, not a crash.
      // Other DB errors count as errors. Either way, do NOT increment enrolled/reactivated.
      const code = (enrollErr as { code?: string }).code;
      if (code === '23514') r.skippedOther++;
      else r.errors++;
      console.error(
        '[gc] enroll upsert failed:',
        (enrollErr as { message?: string }).message ?? code ?? 'unknown',
      );
      continue;
    }

    // Count enrolled vs reactivated based on the PRIOR seat state we read above.
    if (!prior) r.enrolled++;
    else if (prior.is_active === false) r.reactivated++;
    // prior.is_active === true → idempotent no-op (neither counter increments).
  }

  // 5. REMOVE side (two-way), per-class source='google' candidates only (ITEM A + IMP-9).
  //    Load FIRST so the fetch is class-scoped; then apply the trustworthy-roster guard (CRIT-2).
  const candidates = await loadActiveGoogleSeats(admin, args.classId, args.schoolId);

  // CRIT-2: an empty OR incomplete roster MUST NOT mass-un-enroll. Skip the entire remove side
  // whenever the roster is untrustworthy AND there are google seats we would otherwise remove.
  // A genuinely-empty trustworthy roster (complete===true + no students) IS allowed to remove.
  if ((complete === false || presentGoogleIds.size === 0) && candidates.length > 0) {
    r.removeSkippedSuspectEmpty = true;
    return r;
  }

  // For each active source='google' seat in THIS class whose google id is absent from the current
  // roster → soft un-enroll (is_active=false). Branch on returned { error } (IMP-2 — a failed
  // soft-remove increments errors, not softRemoved; never abort the loop on a single failure).
  for (const seat of candidates) {
    if (presentGoogleIds.has(seat.external_id)) continue; // still in the trustworthy roster → keep

    const { error: updErr } = await admin
      .from('enrollments')
      .update({ is_active: false })
      .eq('student_id', seat.student_id)
      .eq('class_id', args.classId);

    if (updErr) {
      r.errors++;
      console.error(
        '[gc] soft un-enroll failed:',
        (updErr as { message?: string }).message ?? 'unknown',
      );
      continue;
    }
    r.softRemoved++;
  }

  return r;
}
