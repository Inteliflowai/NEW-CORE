// Quiet class-insights hub data. NO new data — re-presents loadRosterSignals.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { insightsObservation, type BandMix } from '@/lib/copy/insightsObservation';
import { pctIncorrectToWords } from '@/lib/copy/pctIncorrectToWords';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { loadClassComprehension, type ClassComprehension } from '@/lib/insights/loadClassComprehension';
import { loadClassLearningStyle, type ClassLearningStyle } from '@/lib/insights/loadClassLearningStyle';
import { comprehensionObservation } from '@/lib/copy/comprehensionObservation';

export interface ClassInsights {
  band_mix: BandMix;
  observation: string | null;
  concept_gaps: { skill_name: string; phrase: string }[];
  comprehension: ClassComprehension;
  learning_style: ClassLearningStyle;
}

export async function loadInsights(
  admin: SupabaseClient,
  opts: { classId: string },
): Promise<ClassInsights> {
  const signals = await loadRosterSignals(admin, opts.classId);
  const total = signals.roster.length;
  const band_mix: BandMix = {
    needs_reinforcement: signals.roster.filter((r) => r.band === 'reteach').length,
    on_track: signals.roster.filter((r) => r.band === 'grade_level').length,
    ready_to_enrich: signals.roster.filter((r) => r.band === 'advanced').length,
    not_assessed: signals.roster.filter((r) => r.band === null).length,
    total,
  };
  // pct_incorrect here is sourced only from misconception rows (always ~100), so a derived
  // "N of M" count is meaningless and fabricated. Render WORDS instead (mirrors ConceptGapsRail).
  // Drop unnamed skills and any admin-authored skill_name that carries a banned coach-posture word.
  const concept_gaps = signals.concept_gaps
    .filter((g): g is typeof g & { skill_name: string } => Boolean(g.skill_name) && !hasBannedWord(g.skill_name as string))
    .map((g) => ({
      skill_name: g.skill_name,
      phrase: pctIncorrectToWords(g.pct_incorrect),
    }));
  const [comprehension, learning_style] = await Promise.all([
    loadClassComprehension(admin, opts.classId),
    loadClassLearningStyle(admin, opts.classId),
  ]);
  // Lead with comprehension (names the top reinforce skill); fall back to the band observation;
  // null when the class is balanced/cold-start (quiet on good days).
  const observation = comprehensionObservation(comprehension.skills) ?? insightsObservation(band_mix);
  return { band_mix, observation, concept_gaps, comprehension, learning_style };
}
