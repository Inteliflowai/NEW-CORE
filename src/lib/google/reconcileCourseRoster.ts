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
//
// Concurrency & overlap: this engine is intentionally NOT serialized. Overlapping runs (e.g. a
// teacher "Sync now" during the nightly cron on the same class) can momentarily produce a stale
// soft-remove that SELF-HEALS on the next reconcile via idempotent convergence — accepted pilot
// risk. No advisory lock / no wrapper RPC is used.
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

// loadActiveGoogleSeats — THIS class's active source='google' seats with their provider='google'
// external_id (resolved via LEFT-join semantics: IMP-4 — a seat with no identity row is included
// with external_id undefined so it can still be soft-removed when absent from the roster).
// Class-scoped (IMP-9): never load the school-wide identity set.
// Queries enrollments for student_ids, then external_identities for their google external_ids
// (chunked to ≤200 per .in() call — the pilot never hits the chunk boundary).
//
// SAFETY: a fetch error MUST NOT return [] (empty would look like "no google seats" and silently
// skip the remove side instead of protecting against it). On any error, we return { trustworthy: false }
// so the caller can set removeSkippedSuspectEmpty and skip the remove side entirely.
async function loadActiveGoogleSeats(
  admin: SupabaseClient,
  classId: string,
  schoolId: string,
): Promise<{ trustworthy: false } | { trustworthy: true; seats: Array<{ student_id: string; external_id: string | undefined }> }> {
  const { data: seats, error: seatsError } = await admin
    .from('enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true)
    .eq('source', 'google');

  if (seatsError) {
    console.error('[gc] loadActiveGoogleSeats: enrollments read failed:', (seatsError as { message?: string }).message ?? 'unknown');
    return { trustworthy: false };
  }

  const studentIds = ((seats as Array<{ student_id: string }> | null) ?? []).map(
    (s) => s.student_id,
  );
  if (studentIds.length === 0) return { trustworthy: true, seats: [] };

  // Build a map from student_id → external_id using LEFT-join semantics (IMP-4): a source='google'
  // enrollment with no corresponding external_identities row produces external_id=undefined (not
  // excluded). This ensures orphaned google seats (identity row deleted/never written) are still
  // surfaced as remove candidates.
  const idMap = new Map<string, string>();
  for (let i = 0; i < studentIds.length; i += 200) {
    const chunk = studentIds.slice(i, i + 200);
    const { data: ids, error: idsError } = await admin
      .from('external_identities')
      .select('core_student_id, external_id')
      .eq('school_id', schoolId)
      .eq('provider', 'google')
      .in('core_student_id', chunk);
    if (idsError) {
      console.error('[gc] loadActiveGoogleSeats: external_identities read failed:', (idsError as { message?: string }).message ?? 'unknown');
      return { trustworthy: false };
    }
    for (const row of (ids as Array<{ core_student_id: string | null; external_id: string }> | null) ?? []) {
      if (row.core_student_id) {
        idMap.set(row.core_student_id, row.external_id);
      }
    }
  }

  // LEFT-join: every student_id gets an entry; those without an identity row get external_id=undefined.
  const out: Array<{ student_id: string; external_id: string | undefined }> = studentIds.map(
    (sid) => ({ student_id: sid, external_id: idMap.get(sid) }),
  );
  return { trustworthy: true, seats: out };
}

export async function reconcileCourseRoster(
  admin: SupabaseClient,
  args: ReconcileArgs,
): Promise<ReconcileResult> {
  const r = emptyResult();

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
    // Also select source for IMP-1: a pre-existing manual seat (source NULL/other) must keep its
    // provenance; stamping source='google' on it would pull it into the remove scope on a later run.
    // On a returned error, treat as no prior row (safe: the upsert still proceeds; we count as enrolled).
    const { data: prior, error: priorErr } = await admin
      .from('enrollments')
      .select('is_active, source')
      .eq('class_id', args.classId)
      .eq('student_id', res.studentId)
      .maybeSingle();
    if (priorErr) {
      console.error('[gc] prior-seat read failed (treating as no prior row):', (priorErr as { message?: string }).message ?? 'unknown');
    }

    // IMP-1 provenance guard: only stamp source='google' when there is no prior seat OR the prior
    // seat already has source='google'. A pre-existing manual seat (source NULL/other) must keep its
    // provenance so it stays OUT of the per-class source='google' remove candidates on future runs.
    const priorSource = (prior as { is_active: boolean; source?: string | null } | null)?.source ?? null;
    const hasNonGoogleSeat = prior !== null && priorSource !== 'google';
    const enrollRow: { class_id: string; student_id: string; is_active: boolean; source?: string } = {
      class_id: args.classId, student_id: res.studentId, is_active: true,
      ...(hasNonGoogleSeat ? {} : { source: 'google' }),
    };

    // Enroll the student. supabase-js returns { error } — never throws.
    // Branch on it; incl. the seat-cap check_violation (23514).
    const { error: enrollErr } = await admin.from('enrollments').upsert(
      enrollRow,
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
  const seatResult = await loadActiveGoogleSeats(admin, args.classId, args.schoolId);

  // If the DB fetch itself failed, the candidate set is untrustworthy — skip the remove side.
  if (!seatResult.trustworthy) {
    r.removeSkippedSuspectEmpty = true;
    return r;
  }
  const candidates = seatResult.seats;

  // CRIT-2: A genuinely-empty roster with NO active google seats is a clean no-op; an empty roster
  // WITH active google seats is treated as a suspect/transient empty and skips removal — a true
  // mass-un-enroll is never auto-applied. An incomplete (partial-page) roster also always skips.
  if ((complete === false || presentGoogleIds.size === 0) && candidates.length > 0) {
    r.removeSkippedSuspectEmpty = true;
    return r;
  }

  // For each active source='google' seat in THIS class: soft un-enroll (is_active=false) when the
  // seat's google external_id is absent from the current roster OR when the seat has no resolvable
  // external_id (orphaned seat — IMP-4 LEFT-join). Branch on returned { error } (a failed soft-remove
  // increments errors, not softRemoved; never abort the loop on a single failure).
  for (const seat of candidates) {
    // A seat with a known external_id that is still present in the roster → keep.
    if (seat.external_id !== undefined && presentGoogleIds.has(seat.external_id)) continue;

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
