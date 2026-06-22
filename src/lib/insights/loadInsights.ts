// Quiet class-insights hub data. NO new data — re-presents loadRosterSignals.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { insightsObservation, type BandMix } from '@/lib/copy/insightsObservation';

export interface ClassInsights {
  band_mix: BandMix;
  observation: string | null;
  concept_gaps: { skill_name: string; needs_count: number; total: number }[];
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
  // pct_incorrect is a class-wide "how many got it wrong" share — convert to a count, drop unnamed skills.
  const concept_gaps = signals.concept_gaps
    .filter((g) => g.skill_name)
    .map((g) => ({
      skill_name: g.skill_name as string,
      needs_count: Math.round((g.pct_incorrect / 100) * total),
      total,
    }))
    .filter((g) => g.needs_count > 0);
  return { band_mix, observation: insightsObservation(band_mix), concept_gaps };
}
