// src/app/api/admin/spark-enable/route.ts
// Super-admin one-click SPARK enablement for a school: provisions the SPARK side (dedicated school +
// core_spark_links), writes the V2 platform_links row, and grants the spark_experiences license
// feature (V1-parity). Session-gated (guardPlatformAdmin) — a V2 upgrade over V1's env-secret gate.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardPlatformAdmin } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { provisionSparkSchool } from '@/lib/spark/provisionSparkSchool';
import { provisionSparkLink } from '@/lib/spark/sparkLink';

const CORE_BASE_URL = 'https://newcore.inteliflowai.com';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardPlatformAdmin();
  if (guard) return guard;

  let body: { school_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }); }
  const schoolId = body.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Missing school_id' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: school } = await admin.from('schools').select('id, name').eq('id', schoolId).maybeSingle();
  if (!school) return NextResponse.json({ error: 'Unknown school_id' }, { status: 404 });

  const steps: Record<string, string> = {};

  // 1. SPARK side (dedicated spark school + link + core_integration flag).
  const sparkRes = await provisionSparkSchool({ coreSchoolId: school.id as string, name: school.name as string, coreBaseUrl: CORE_BASE_URL });
  steps.spark = sparkRes.success ? `ok (${sparkRes.sparkSchoolId})` : `failed: ${sparkRes.error}`;

  // 2. V2 platform_links row (the gate).
  try {
    await provisionSparkLink(admin, { schoolId: school.id as string, apiKey: `core_spark_${randomUUID()}`, coreBaseUrl: CORE_BASE_URL, label: 'SPARK' });
    steps.link = 'ok';
  } catch (e) { steps.link = `failed: ${(e as Error).message}`; }

  // 3. License feature grant (V1-parity): school_licenses.feature_overrides.spark_experiences = true.
  try {
    const { data: lic } = await admin.from('school_licenses').select('feature_overrides').eq('school_id', school.id).maybeSingle();
    const overrides = { ...(lic?.feature_overrides ?? {}), spark_experiences: true };
    if (lic) {
      await admin.from('school_licenses').update({ feature_overrides: overrides }).eq('school_id', school.id);
      steps.license = 'ok';
    } else {
      steps.license = 'skipped (no license row)';
    }
  } catch (e) { steps.license = `failed: ${(e as Error).message}`; }

  return NextResponse.json({ ok: sparkRes.success && steps.link === 'ok', spark_school_id: sparkRes.sparkSchoolId ?? null, steps });
}
