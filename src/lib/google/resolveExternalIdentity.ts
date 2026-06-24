// src/lib/google/resolveExternalIdentity.ts
// WRITE-FREE service-role identity resolver against external_identities. Order: external_id-first,
// then UNAMBIGUOUS lowercased-email (exactly one distinct core_student_id, else null). NEVER
// auto-creates — auto-create is the roster-import path only (linkOrCreateStudent). Seg 4 (silent
// SSO launch) is the consumer; Seg 2 ships it but does not call it.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolveArgs {
  schoolId: string;
  provider: string;
  externalId: string | null;
  email: string | null;
}

export async function resolveExternalIdentity(admin: SupabaseClient, args: ResolveArgs): Promise<string | null> {
  // 1. external_id-first (the canonical link, unique per school+provider).
  if (args.externalId) {
    const { data } = await admin
      .from('external_identities')
      .select('core_student_id')
      .eq('school_id', args.schoolId)
      .eq('provider', args.provider)
      .eq('external_id', args.externalId)
      .maybeSingle();
    if (data?.core_student_id) return data.core_student_id as string;
  }
  // 2. Unambiguous lowercased-email match within (school, provider). Exact .eq() on the
  //    lowercased value (rows are written lowercased per Task 4) — NOT .ilike, which would treat
  //    %/_ as LIKE metacharacters on an identity key (IMP-5) and would not use the plain index.
  if (args.email) {
    const { data } = await admin
      .from('external_identities')
      .select('core_student_id')
      .eq('school_id', args.schoolId)
      .eq('provider', args.provider)
      .eq('email', args.email.toLowerCase());
    const ids = new Set(
      ((data as Array<{ core_student_id: string | null }> | null) ?? [])
        .map((r) => r.core_student_id)
        .filter((v): v is string => !!v),
    );
    if (ids.size === 1) return [...ids][0];
  }
  return null;
}
