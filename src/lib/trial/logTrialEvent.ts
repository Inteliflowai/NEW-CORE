/**
 * src/lib/trial/logTrialEvent.ts
 *
 * Ported from V1 lib/trial/logTrialEvent.ts. Inserts a lifecycle breadcrumb into
 * public.trial_events (0007_licensing.sql). `event_type` is constrained to an
 * 18-value CHECK enum that includes 'trial_signup'.
 *
 * Soft-fail: a failed breadcrumb must never abort provisioning — log and swallow.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LogTrialEventParams {
  admin: SupabaseClient;
  schoolId: string;
  userId?: string | null;
  eventType: string; // e.g. 'trial_signup' — must be a valid trial_events.event_type
  metadata?: Record<string, unknown>;
}

export async function logTrialEvent({
  admin,
  schoolId,
  userId = null,
  eventType,
  metadata = {},
}: LogTrialEventParams): Promise<void> {
  const { error } = await admin.from('trial_events').insert({
    school_id: schoolId,
    user_id: userId,
    event_type: eventType,
    metadata,
  });
  if (error) {
    console.error(`[trial] logTrialEvent(${eventType}) failed (soft):`, error.message);
  }
}
