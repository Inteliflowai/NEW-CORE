// src/lib/spark/provisionSparkSchool.ts — V2→SPARK provisioning call (creates the dedicated SPARK
// school + core_spark_links so the SPARK side is ready). Pairs with provisionSparkLink (V2 side).
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from './config';

export interface ProvisionSparkSchoolInput {
  coreSchoolId: string;
  name: string;
  coreBaseUrl?: string | null;
  /** The V2 platform_links api_key CORE will actually authenticate with. When present, SPARK's
   *  core_spark_links row is upserted with this SAME key (Item 1 fix) — without it, SPARK
   *  defaults to an unrelated generated uuid and every subsequent get_attempt_review call 401s. */
  apiKey?: string;
}
export interface ProvisionSparkSchoolResult {
  success: boolean;
  sparkSchoolId?: string;
  error?: string;
}

export async function provisionSparkSchool(input: ProvisionSparkSchoolInput): Promise<ProvisionSparkSchoolResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const res = await fetch(`${SPARK_API_URL}/api/integration/provision-school`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CORE_SPARK_API_SECRET}` },
      body: JSON.stringify({
        core_school_id: input.coreSchoolId,
        name: input.name,
        core_base_url: input.coreBaseUrl ?? null,
        ...(input.apiKey ? { api_key: input.apiKey } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { success: false, error: `SPARK HTTP ${res.status}` };
    const json = (await res.json()) as { success?: boolean; spark_school_id?: string; error?: string };
    return { success: json.success === true, sparkSchoolId: json.spark_school_id, error: json.error };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
