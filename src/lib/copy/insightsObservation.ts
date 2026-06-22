// One calm, class-level "what this means" line + band-pill labels. Leak-guarded.
// DRAFT → Barb (STRINGS-FOR-BARB.md §Insights). Quiet on good days (returns null).
import { assertNoBannedWord } from '@/lib/copy/leakGuard';

export interface BandMix {
  needs_reinforcement: number;
  on_track: number;
  ready_to_enrich: number;
  not_assessed: number;
  total: number;
}

const PILL_LABELS: Record<'needs_reinforcement' | 'on_track' | 'ready_to_enrich' | 'not_assessed', string> = {
  needs_reinforcement: 'Needs reinforcement',
  on_track: 'On track',
  ready_to_enrich: 'Ready to enrich',
  not_assessed: 'Not yet assessed',
};

export function bandPillLabel(key: keyof typeof PILL_LABELS): string {
  return PILL_LABELS[key];
}

export function insightsObservation(mix: BandMix): string | null {
  const assessed = mix.needs_reinforcement + mix.on_track + mix.ready_to_enrich;
  if (assessed === 0) return null; // cold-start: quiet
  const reinforceShare = mix.needs_reinforcement / assessed;
  const enrichShare = mix.ready_to_enrich / assessed;

  let line: string | null = null;
  if (reinforceShare >= 0.4) {
    line = 'A good part of the class is still finding their footing — the latest concept may be worth a whole-class re-teach.';
  } else if (enrichShare >= 0.5) {
    line = 'Most of the class is ready for deeper work on the same topic.';
  } else if (mix.needs_reinforcement > 0 && mix.ready_to_enrich > 0) {
    line = 'The class is split between students who need another pass and students ready to go deeper — small groups will help.';
  }
  if (line) assertNoBannedWord(line, 'insightsObservation');
  return line;
}
