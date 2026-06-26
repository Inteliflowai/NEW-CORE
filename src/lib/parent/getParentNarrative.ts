// src/lib/parent/getParentNarrative.ts
//
// SINGLE shared cache layer for the parent Learning Summary narrative.
// Used by BOTH the API route (GET /api/parent/narrative) AND the dashboard
// server component (Task 7) so every caller goes through the same 24h cache
// and the AI is never called on a cache-hit regardless of entry point.
//
// Import-safe: no next/server, no module-load Supabase singleton.
// Admin-client-injected: callers supply `admin` (createAdminSupabaseClient()).
// NEVER throws: the engine never throws; upsert errors are logged and swallowed.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadParentNarrativeContext } from '@/lib/parent/loadParentNarrativeContext';
import { generateParentNarrative } from '@/lib/engine/parentNarrative';

// ── Constants ─────────────────────────────────────────────────────────────────

/** 24-hour cache TTL in milliseconds. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParentNarrativePayload {
  paragraphs: string[];
  conversation_starters: string[];
  source: string;
}

export interface GetParentNarrativeResult extends ParentNarrativePayload {
  generated_at: string;
}

// ── Cache row shape (from parent_narratives table) ────────────────────────────

interface CacheRow {
  payload: ParentNarrativePayload;
  generated_at: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the cached parent narrative (if < 24h old and not forced), or
 * generates → upserts → returns a fresh one.
 *
 * @param admin  Service-role Supabase client (bypasses RLS; caller must have
 *               already performed the IDOR guard via guardStudentAccess).
 * @param studentId  The student whose narrative to load.
 * @param opts.force  If true, bypass the cache and regenerate unconditionally.
 *
 * NEVER throws. Cache upsert failures are logged but do not surface as errors.
 */
export async function getParentNarrative(
  admin: SupabaseClient,
  studentId: string,
  opts?: { force?: boolean },
): Promise<GetParentNarrativeResult> {
  const force = opts?.force ?? false;

  // ── 1. Cache-read ──────────────────────────────────────────────────────────
  if (!force) {
    const { data: row } = await admin
      .from('parent_narratives')
      .select('payload, generated_at')
      .eq('student_id', studentId)
      .maybeSingle();

    const cached = row as CacheRow | null;
    if (cached) {
      const ageMs = Date.now() - new Date(cached.generated_at).getTime();
      if (ageMs < CACHE_TTL_MS) {
        // Cache hit — return without calling the AI
        return {
          paragraphs: cached.payload.paragraphs,
          conversation_starters: cached.payload.conversation_starters,
          source: cached.payload.source,
          generated_at: cached.generated_at,
        };
      }
    }
  }

  // ── 2. Generate ───────────────────────────────────────────────────────────
  const ctx = await loadParentNarrativeContext(admin, studentId);
  const result = await generateParentNarrative(ctx);

  const payload: ParentNarrativePayload = {
    paragraphs: result.paragraphs,
    conversation_starters: result.conversation_starters,
    source: result.source,
  };
  const generated_at = new Date().toISOString();

  // ── 3. Upsert ─────────────────────────────────────────────────────────────
  // Best-effort: a DB failure must NOT cause this to throw and break the
  // parent dashboard render — the AI result is returned regardless.
  try {
    const { error } = await admin
      .from('parent_narratives')
      .upsert(
        { student_id: studentId, payload, generated_at, updated_at: generated_at },
        { onConflict: 'student_id' },
      );
    if (error) {
      console.error('[getParentNarrative] cache upsert failed:', error);
    }
  } catch (err) {
    console.error('[getParentNarrative] cache upsert threw:', err);
  }

  return { ...payload, generated_at };
}
