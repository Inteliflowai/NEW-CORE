// src/lib/spark/provisionSparkSchool.ts — V2→SPARK provisioning call (creates the dedicated SPARK
// school + core_spark_links so the SPARK side is ready). Pairs with provisionSparkLink (V2 side).
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from './config';

export interface ProvisionSparkSchoolInput {
  coreSchoolId: string;
  name: string;
  coreBaseUrl?: string | null;
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
      body: JSON.stringify({ core_school_id: input.coreSchoolId, name: input.name, core_base_url: input.coreBaseUrl ?? null }),
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
