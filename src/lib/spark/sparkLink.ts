// src/lib/spark/sparkLink.ts — read/provision a school's SPARK platform_links row.
// Phase-1 SPARK gate = presence of an ENABLED product='spark' row (no license table exists).
// platform_links is RLS-deny-to-clients; callers must pass the admin (service-role) client.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SparkLink {
  api_key: string;
  core_base_url: string | null;
  enabled: boolean;
}

export async function getSparkLink(admin: SupabaseClient, schoolId: string): Promise<SparkLink | null> {
  const { data } = await admin
    .from('platform_links')
    .select('api_key, core_base_url, enabled')
    .eq('school_id', schoolId)
    .eq('product', 'spark')
    .maybeSingle();
  if (!data || (data as SparkLink).enabled !== true) return null;
  return data as SparkLink;
}

export async function isSparkEnabled(admin: SupabaseClient, schoolId: string): Promise<boolean> {
  return (await getSparkLink(admin, schoolId)) !== null;
}

export interface ProvisionSparkLinkArgs {
  schoolId: string;
  apiKey: string;
  coreBaseUrl?: string | null;
  label?: string;
}

export async function provisionSparkLink(admin: SupabaseClient, args: ProvisionSparkLinkArgs): Promise<void> {
  const { error } = await admin.from('platform_links').upsert(
    {
      school_id: args.schoolId,
      product: 'spark',
      api_key: args.apiKey,
      core_base_url: args.coreBaseUrl ?? null,
      label: args.label ?? 'SPARK',
      enabled: true,
    },
    { onConflict: 'school_id,product' },
  );
  if (error) throw new Error(`provisionSparkLink failed: ${error.message}`);
}
