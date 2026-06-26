// src/app/api/parent/narrative/route.ts
// GET /api/parent/narrative?studentId=<uuid>&force=1
//
// Returns the AI-generated parent Learning Summary for a given student.
// Reads the 24h cache via the shared `getParentNarrative` loader. Cache-hits
// are returned ungated (no rate-limit spend). Cache-misses and force-refreshes
// (generation path) ARE rate-limited per user.
//
// Auth chain:
//   createServerSupabaseClient → getUser (401 if absent)
//   → guardStudentAccess(studentId) (403 if not parent/teacher/admin/self)
//   → check cache via admin client — if fresh → return (no rate-limit)
//   → enforceAiRateLimit(user.id) — 429 if over limit
//   → getParentNarrative(admin, studentId, {force}) — never throws
//
// RLS is NOT the IDOR backstop; guardStudentAccess is.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { enforceAiRateLimit } from '@/lib/rateLimit';
import { getParentNarrative } from '@/lib/parent/getParentNarrative';

/** 24-hour TTL in ms — mirrors getParentNarrative's internal constant. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheRow {
  payload: { paragraphs: string[]; conversation_starters: string[]; source: string };
  generated_at: string;
}

export async function GET(req: Request) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse query params ──────────────────────────────────────────────────
  const sp = new URL(req.url).searchParams;
  const studentId = sp.get('studentId');
  const force = sp.get('force') === '1';

  if (!studentId) {
    return NextResponse.json({ error: 'Missing studentId' }, { status: 400 });
  }

  // ── 3. IDOR guard ──────────────────────────────────────────────────────────
  // Must run BEFORE any data read. Returns NextResponse on denial, null to proceed.
  const denied = await guardStudentAccess(studentId);
  if (denied) return denied;

  // ── 4. Admin client ────────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();

  // ── 5. Cache-check (ungated) ───────────────────────────────────────────────
  // Read the cache directly so we can return a fresh hit WITHOUT consuming a
  // rate-limit token. Only the generation/force path is gated.
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
        // Fresh cache hit — return without calling the AI or the rate limiter
        return NextResponse.json({
          paragraphs: cached.payload.paragraphs,
          conversation_starters: cached.payload.conversation_starters,
          source: cached.payload.source,
          generated_at: cached.generated_at,
        });
      }
    }
  }

  // ── 6. Rate limit (generation path only) ──────────────────────────────────
  const limited = await enforceAiRateLimit(user.id);
  if (limited) return limited;

  // ── 7. Generate / refresh ─────────────────────────────────────────────────
  // getParentNarrative never throws (engine is fail-soft; upsert errors are
  // logged + swallowed). Pass force so it skips the internal cache read too.
  const result = await getParentNarrative(admin, studentId, { force });

  return NextResponse.json(result);
}
