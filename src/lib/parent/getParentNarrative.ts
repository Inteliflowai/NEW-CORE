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
import { parentLeaks } from '@/lib/copy/parentGuard';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Drop any paragraph or conversation_starter that leaks parent-forbidden content.
 * Belt-and-suspenders: the engine already validates, so this is a safety net on both
 * the cache-hit path (M2: catches rows written under an older guard) and the fresh path.
 */
function filterPayloadLeaks(payload: ParentNarrativePayload): ParentNarrativePayload {
  return {
    ...payload,
    paragraphs: payload.paragraphs.filter((p) => parentLeaks(p).length === 0),
    conversation_starters: payload.conversation_starters.filter(
      (s) => parentLeaks(s).length === 0,
    ),
  };
}

/**
 * Returns true if ANY paragraph or conversation_starter in the payload contains
 * a forbidden term — indicating the row was written under an older guard version.
 */
function payloadHasLeak(payload: ParentNarrativePayload): boolean {
  return (
    payload.paragraphs.some((p) => parentLeaks(p).length > 0) ||
    payload.conversation_starters.some((s) => parentLeaks(s).length > 0)
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the cached parent narrative (if < 24h old, not forced, and clean against
 * the live guard), or generates → upserts → returns a fresh one.
 *
 * @param admin  Service-role Supabase client (bypasses RLS; caller must have
 *               already performed the IDOR guard via guardStudentAccess).
 * @param studentId  The student whose narrative to load.
 * @param opts.force  If true, bypass the cache and regenerate unconditionally.
 *
 * NEVER throws. Cache read/upsert failures and context-load failures are logged
 * but do not surface as errors — the function always resolves (ENG-2).
 */
export async function getParentNarrative(
  admin: SupabaseClient,
  studentId: string,
  opts?: { force?: boolean },
): Promise<GetParentNarrativeResult> {
  const force = opts?.force ?? false;

  // ── 1. Cache-read ──────────────────────────────────────────────────────────
  if (!force) {
    let cached: CacheRow | null = null;

    // ENG-2: Wrap cache read in try/catch — a DB error is treated as a cache-miss.
    try {
      const { data: row } = await admin
        .from('parent_narratives')
        .select('payload, generated_at')
        .eq('student_id', studentId)
        .maybeSingle();
      cached = row as CacheRow | null;
    } catch (err) {
      // Cache read error → fall through to regenerate (treat as cache-miss)
      console.error('[getParentNarrative] cache read threw — treating as cache-miss:', err);
    }

    if (cached) {
      const ageMs = Date.now() - new Date(cached.generated_at).getTime();
      if (ageMs < CACHE_TTL_MS) {
        // M2: Re-validate against the LIVE guard on every cache hit.
        // If ANY item leaked (row was written under an older guard), treat as
        // STALE and fall through to regenerate — do NOT return poisoned content.
        if (payloadHasLeak(cached.payload)) {
          console.warn(
            '[getParentNarrative] cache hit contained leaked content — treating as stale and regenerating',
          );
          // fall through to the generate path below
        } else {
          // Cache hit — clean and fresh
          return {
            paragraphs: cached.payload.paragraphs,
            conversation_starters: cached.payload.conversation_starters,
            source: cached.payload.source,
            generated_at: cached.generated_at,
          };
        }
      }
    }
  }

  // ── 2. Load context ────────────────────────────────────────────────────────
  // ENG-2: Wrap the context load in try/catch — an error produces a minimal
  // context that yields the engine's own deterministic fallback. getParentNarrative
  // must never reject regardless of what loadParentNarrativeContext does.
  let ctx;
  try {
    ctx = await loadParentNarrativeContext(admin, studentId);
  } catch (err) {
    console.error('[getParentNarrative] context load threw — using fallback context:', err);
    ctx = {
      firstName: 'Student',
      gradeTrendDirection: null as 'climbing' | 'steady' | 'sliding' | null,
      hasGrowth: false,
      dataPoints: 0,
      learningStyleLabel: null as string | null,
      recentTopics: [] as string[],
    };
  }

  // ── 3. Generate ───────────────────────────────────────────────────────────
  const result = await generateParentNarrative(ctx);

  // M2 (fresh path): filter leaked items as a safety net.
  // Engine already validated, so this is typically a no-op, but keeps the
  // guarantee even if the engine changes or a prompt-injection slips through.
  const filtered = filterPayloadLeaks({
    paragraphs: result.paragraphs,
    conversation_starters: result.conversation_starters,
    source: result.source,
  });
  const generated_at = new Date().toISOString();

  // ── 4. Upsert ─────────────────────────────────────────────────────────────
  // M5: SKIP the upsert when source === 'fallback' — a transient fallback must
  // not be cached at 24h (the next request should retry the AI). Only 'ai' /
  // 'ai_retry' results are worth caching.
  //
  // Best-effort: a DB failure must NOT cause this to throw and break the
  // parent dashboard render — the AI result is returned regardless.
  if (result.source !== 'fallback') {
    try {
      const { error } = await admin
        .from('parent_narratives')
        .upsert(
          { student_id: studentId, payload: filtered, generated_at, updated_at: generated_at },
          { onConflict: 'student_id' },
        );
      if (error) {
        console.error('[getParentNarrative] cache upsert failed:', error);
      }
    } catch (err) {
      console.error('[getParentNarrative] cache upsert threw:', err);
    }
  }

  return { ...filtered, generated_at };
}
