// src/app/api/attempts/spark-attempt-complete/route.ts
// SPARK→CORE completion ingestion (the exact path SPARK's core-client.ts posts to).
// Auth: constant-time Bearer vs CORE_SPARK_API_SECRET. Identity: CORE-native (users.id +
// assignments.id) — no external_identities. Idempotent via webhook_idempotency_keys. Feeds
// the skill engine. NEVER 5xx for business outcomes (200 + status body); only 401/400 are non-200.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import { bearerMatches } from '@/lib/spark/auth';
import { CORE_SPARK_API_SECRET } from '@/lib/spark/config';
import { computeTransferScore, type RubricDimensions } from '@/lib/spark/contract';

const ENDPOINT = '/api/attempts/spark-attempt-complete';
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 60_000; // an in_progress claim older than this with no terminal status is presumed dead

interface AttemptCompletePayload {
  core_homework_id?: string;
  student_id?: string;
  completed_at?: string;
  score?: number | null;
  effort_label?: string | null;
  revision_count?: number;
  teli_hint_count?: number;
  signal_summary?: Record<string, unknown>;
  rubric_dimensions?: Partial<RubricDimensions> | null;
  content_quality?: 'engaged' | 'minimal' | 'non_engaged' | null;
}

type Admin = ReturnType<typeof createAdminSupabaseClient>;

async function finalize(admin: Admin, key: string, status: 'completed' | 'failed', body: unknown): Promise<void> {
  await admin
    .from('webhook_idempotency_keys')
    .update({ status, response_body: body })
    .eq('endpoint', ENDPOINT)
    .eq('idempotency_key', key);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — constant-time Bearer (never user auth).
  if (!bearerMatches(req.headers.get('authorization'), CORE_SPARK_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse + required ids.
  let payload: AttemptCompletePayload;
  try {
    payload = (await req.json()) as AttemptCompletePayload;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }
  const coreHomeworkId = payload.core_homework_id;
  const studentId = payload.student_id;
  if (!coreHomeworkId || !studentId) {
    return NextResponse.json({ error: 'Missing core_homework_id or student_id' }, { status: 400 });
  }

  const idempotencyKey = req.headers.get('x-idempotency-key') ?? `${coreHomeworkId}_${studentId}`;
  const admin = createAdminSupabaseClient();

  // 3. Idempotency: claim the key (in_progress). Replay → stored response.
  const claim = await admin.from('webhook_idempotency_keys').insert({
    endpoint: ENDPOINT,
    idempotency_key: idempotencyKey,
    status: 'in_progress',
    expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
  });
  if (claim.error) {
    const code = (claim.error as { code?: string }).code;
    if (code === '23505') {
      // Key already seen. Three cases: terminal replay, fresh concurrent run, or a stale (dead) claim.
      const { data: existing } = await admin
        .from('webhook_idempotency_keys')
        .select('status, response_body, created_at')
        .eq('endpoint', ENDPOINT)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      const row = existing as { status?: string; response_body?: unknown; created_at?: string } | null;
      if (row && row.status !== 'in_progress' && row.response_body) {
        // Terminal replay → return the stored response.
        return NextResponse.json(row.response_body, { status: 200 });
      }
      const claimIsFresh =
        !!row?.created_at && Date.now() - new Date(row.created_at).getTime() < CLAIM_TTL_MS;
      if (row?.status === 'in_progress' && claimIsFresh) {
        // Genuine concurrent run still in flight → acknowledge, don't double-process.
        return NextResponse.json({ ok: true, received: true, deduped: true }, { status: 200 });
      }
      // Stale in_progress (claimer crashed/timed out) or missing created_at → reclaim and reprocess.
      // Reset created_at so a second concurrent retry during reprocessing sees a fresh claim.
      // Safe: the spark_completions upsert and recompute are idempotent.
      await admin
        .from('webhook_idempotency_keys')
        .update({ status: 'in_progress', created_at: new Date().toISOString() })
        .eq('endpoint', ENDPOINT)
        .eq('idempotency_key', idempotencyKey);
      // Fall through to the processing block below.
    }
    // Non-unique claim error (e.g. transient): proceed best-effort (upsert is idempotent), no finalize row to update.
    console.error('[spark-attempt-complete] idempotency claim error (proceeding best-effort):', claim.error);
  }

  try {
    // 4. Resolve the assignment (CORE-native) + verify ownership.
    const { data: assignmentRow } = await admin
      .from('assignments')
      .select('id, student_id, class_id, skill_ids')
      .eq('id', coreHomeworkId)
      .maybeSingle();
    const assignment = assignmentRow as
      | { id: string; student_id: string; class_id: string; skill_ids: string[] | null }
      | null;
    if (!assignment || assignment.student_id !== studentId) {
      const bodyOut = { ok: true, received: true, ignored: 'unknown_assignment' };
      await finalize(admin, idempotencyKey, 'failed', bodyOut);
      return NextResponse.json(bodyOut, { status: 200 });
    }

    const { data: userRow } = await admin.from('users').select('school_id').eq('id', studentId).maybeSingle();
    const schoolId = (userRow as { school_id?: string } | null)?.school_id ?? null;

    const transferScore = computeTransferScore(payload.rubric_dimensions, payload.score);

    // 5. Upsert the completion (submit-time creates; analyzer pass overwrites on the same row).
    await admin.from('spark_completions').upsert(
      {
        assignment_id: assignment.id,
        student_id: studentId,
        school_id: schoolId,
        score: typeof payload.score === 'number' ? Math.round(payload.score) : null,
        effort_label: payload.effort_label ?? null,
        rubric_dimensions: payload.rubric_dimensions ?? null,
        content_quality: payload.content_quality ?? null,
        transfer_score: transferScore,
        revision_count: payload.revision_count ?? null,
        teli_hint_count: payload.teli_hint_count ?? null,
        signal_summary: payload.signal_summary ?? null,
        completed_at: payload.completed_at ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'assignment_id,student_id' },
    );

    // 6. Audit.
    await admin.from('platform_events').insert({
      source: 'spark',
      event_type: 'spark_attempt_complete',
      school_id: schoolId,
      student_id: studentId,
      payload: {
        core_homework_id: coreHomeworkId,
        idempotency_key: idempotencyKey,
        content_quality: payload.content_quality ?? null,
        transfer_score: transferScore,
      },
      processed: true,
    });

    // 7. Feed the engine (never throws; scoped to the assignment's skills, else full per-student sweep).
    const skillIds = (assignment.skill_ids ?? []).length > 0 ? (assignment.skill_ids as string[]) : undefined;
    await recomputeSkillStatesForStudent(admin, { studentId, schoolId, skillIds });

    const bodyOut = { ok: true, received: true };
    await finalize(admin, idempotencyKey, 'completed', bodyOut);
    return NextResponse.json(bodyOut, { status: 200 });
  } catch (err) {
    console.error('[spark-attempt-complete] processing error (returning 200 per webhook discipline):', err);
    const bodyOut = { ok: true, received: true, error: 'processing_error' };
    await finalize(admin, idempotencyKey, 'failed', bodyOut);
    return NextResponse.json(bodyOut, { status: 200 });
  }
}
