// src/lib/audit/logAudit.ts
// Best-effort append-only audit write. The single writer of public.audit_logs (migration 0026).
// NEVER throws — a logging failure must never roll back or 500 the action being audited.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEntry {
  actorId: string | null;      // the staff user id; null = system/cron
  schoolId: string | null;     // the affected school (stamp whenever known)
  action: string;              // dotted verb, e.g. 'grade.override'
  resourceType: string;        // e.g. 'homework_attempt' | 'class' | 'school'
  resourceId: string | null;   // the affected row id
  metadata?: Record<string, unknown>; // {before,after} for changes; counts for summaries
}

export async function logAudit(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await admin.from('audit_logs').insert({
      actor_id: entry.actorId,
      school_id: entry.schoolId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      metadata: entry.metadata ?? {},
    });
    if (error) console.error('[audit] insert failed (non-fatal):', (error as { message?: string }).message ?? error);
  } catch (err) {
    console.error('[audit] insert threw (non-fatal):', err);
  }
}
