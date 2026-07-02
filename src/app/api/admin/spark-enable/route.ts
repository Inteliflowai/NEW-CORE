// src/app/api/admin/spark-enable/route.ts
// Super-admin one-click SPARK enablement for a school: provisions the SPARK side (dedicated school +
// core_spark_links), writes the V2 platform_links row, and grants the spark_experiences license
// feature (V1-parity). Session-gated (guardPlatformAdmin) — a V2 upgrade over V1's env-secret gate.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardPlatformAdmin } from '@/lib/auth/guards';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { provisionSparkSchool } from '@/lib/spark/provisionSparkSchool';
import { provisionSparkLink } from '@/lib/spark/sparkLink';
import { logAudit } from '@/lib/audit/logAudit';

const CORE_BASE_URL = 'https://newcore.inteliflowai.com';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardPlatformAdmin();
  if (guard) return guard;

  // Obtain actor id — guardPlatformAdmin does NOT expose the caller id.
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  let body: { school_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }); }
  const schoolId = body.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Missing school_id' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: school } = await admin.from('schools').select('id, name').eq('id', schoolId).maybeSingle();
  if (!school) return NextResponse.json({ error: 'Unknown school_id' }, { status: 404 });

  const steps: Record<string, string> = {};

  // 1. Resolve the api_key FIRST (reuse-or-mint, idempotent on re-enable). CORE is the key
  //    source of truth (Item 1 fix): SPARK needs to learn this SAME key at provision time, or
  //    its core_spark_links row defaults to an unrelated uuid and every get_attempt_review
  //    call 401s forever. Never throws — a select failure just falls back to minting fresh.
  let apiKey: string;
  try {
    const { data: existingLink } = await admin
      .from('platform_links').select('api_key').eq('school_id', school.id).eq('product', 'spark').maybeSingle();
    apiKey = existingLink?.api_key ?? `core_spark_${randomUUID()}`;
  } catch {
    apiKey = `core_spark_${randomUUID()}`;
  }

  // 2. SPARK side (dedicated spark school + link + core_integration flag). Pass apiKey so
  //    SPARK's core_spark_links.api_key matches the credential CORE will actually send.
  const sparkRes = await provisionSparkSchool({ coreSchoolId: school.id as string, name: school.name as string, coreBaseUrl: CORE_BASE_URL, apiKey });
  steps.spark = sparkRes.success ? `ok (${sparkRes.sparkSchoolId})` : `failed: ${sparkRes.error}`;

  // 3. V2 platform_links row (the gate). Idempotent: reuse an existing api_key on re-enable
  //    so a repeat enable preserves the credential instead of rotating it.
  try {
    await provisionSparkLink(admin, { schoolId: school.id as string, apiKey, coreBaseUrl: CORE_BASE_URL, label: 'SPARK' });
    steps.link = 'ok';
  } catch (e) { steps.link = `failed: ${(e as Error).message}`; }

  // 4. License feature grant (V1-parity): school_licenses.feature_overrides.spark_experiences = true.
  //    Capture the update error so a failed grant is reflected in steps.license (not silently 'ok').
  try {
    const { data: lic } = await admin.from('school_licenses').select('feature_overrides').eq('school_id', school.id).maybeSingle();
    const overrides = { ...(lic?.feature_overrides ?? {}), spark_experiences: true };
    if (lic) {
      const { error: licErr } = await admin.from('school_licenses').update({ feature_overrides: overrides }).eq('school_id', school.id);
      steps.license = licErr ? `failed: ${licErr.message}` : 'ok';
    } else {
      steps.license = 'skipped (no license row)';
    }
  } catch (e) { steps.license = `failed: ${(e as Error).message}`; }

  const ok = sparkRes.success && steps.link === 'ok' && (steps.license === 'ok' || steps.license.startsWith('skipped'));

  if (ok) {
    await logAudit(admin, {
      actorId: user?.id ?? null,
      schoolId: school.id as string,
      action: 'spark.enable',
      resourceType: 'school',
      resourceId: school.id as string,
      metadata: { school_id: school.id },
    });
  }

  return NextResponse.json({ ok, spark_school_id: sparkRes.sparkSchoolId ?? null, steps });
}
