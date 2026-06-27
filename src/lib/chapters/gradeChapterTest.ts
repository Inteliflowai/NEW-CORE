// src/lib/chapters/gradeChapterTest.ts
// Stub — grading pipeline implemented in Seg5.
// This file exists so T3 (submit route) can import it without a missing-module error.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Stub — implemented in Seg5 */
export async function gradeChapterAttempt(attemptId: string, admin: SupabaseClient): Promise<void> {
  // Seg5 implementation
  void attemptId;
  void admin;
}
