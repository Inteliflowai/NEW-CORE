// ============================================================
// src/lib/skills/computeSkillState.ts
// Phase 2b — pure Can't-vs-Time fusion. No DB / AI imports
// (Bug #27 sibling-pure-file pattern); fully unit-testable.
//
// Fuses per-skill observations into ONE observational state:
//
//   needs_different_instruction  "can't do it this way yet" —
//     conceptual error pattern dominates while practice isn't
//     moving the needle, and/or the student performs with
//     scaffolding (homework) but fails cold (quiz).
//
//   needs_more_time  "on the right track" — accuracy improving
//     with practice, errors trending careless/procedural (slips,
//     not concept gaps), no scaffold-vs-cold divergence.
//
//   on_track  cold accuracy at mastery and holding.
//
//   insufficient_data  the anti-noise guard. Fires when there are
//     fewer than MIN_OBSERVATIONS graded observations OR when the
//     dominant signature is non-submission ("didn't do it" must
//     NEVER be scored as "can't do it").
//
//   not_attempted  no contact with the skill at all.
//
// All thresholds live in SKILL_STATE_WEIGHTS below — documented,
// centralized, and expected to be tuned during pilot once real
// classrooms generate data. Change them THERE, never inline.
// ============================================================

import { z } from 'zod';

export type SkillLearningState =
  | 'needs_different_instruction'
  | 'needs_more_time'
  | 'on_track'
  | 'ready_to_extend'
  | 'insufficient_data'
  | 'not_attempted';

export interface SkillQuizObservation {
  /** Cold (unscaffolded) per-question correctness on this skill. */
  isCorrect: boolean;
  occurredAt: string; // ISO
}

export interface SkillHomeworkObservation {
  /** Assignment-level grade 0-100; null = ungraded (not an observation). */
  gradePct: number | null;
  /** false = assignment existed but was never submitted. */
  submitted: boolean;
  occurredAt: string; // ISO
  /** lib/signals/computeEffortLabel.ts vocabulary. */
  effortLabel?: string | null;
}

export interface SkillReteachEvent {
  /**
   * Derived from the live reteach mechanisms:
   *   'more_practice'      ← Targeted Practice (content.kind='targeted_practice')
   *   'different_approach' ← Full Reteach (reteach_needed=true, scaffold bumped)
   */
  type: 'more_practice' | 'different_approach';
  completedAt: string; // ISO
}

export interface SkillSparkObservation {
  /**
   * 0-100 transfer score for this SPARK completion: average of the
   * non-null 7-dim rubric values × 25 (same mapping the BNCC roll-up
   * uses), falling back to SPARK's own 0-100 score when the analyzer
   * dims are absent. null = completion recorded but never scored
   * (submit-time webhook only) — counts as contact, not as a graded
   * observation.
   */
  transferScore: number | null;
  /**
   * SPARK analyzer's engagement classification. 'non_engaged' and
   * 'minimal' completions are NOT skill evidence (engagement-guard
   * parity: "didn't engage" must never be scored as "can't").
   */
  contentQuality: 'engaged' | 'minimal' | 'non_engaged' | null;
  completed: boolean;
  occurredAt: string; // ISO
}

export interface SkillStateInput {
  quiz: SkillQuizObservation[];
  homework: SkillHomeworkObservation[];
  /**
   * Session-level cognitive_signals.error_pattern_type values from
   * the student's quiz sessions (chronological). Session-level, not
   * per-skill — labeled as such in the evidence.
   */
  sessionErrorPatterns: string[];
  /** Most recent completed reteach touching this skill, if any. */
  reteach?: SkillReteachEvent | null;
  /**
   * SPARK simulation completions attributed to this skill via the
   * parent assignment's skill_ids (assignment-level attribution —
   * same granularity as homework observations). SPARK is a
   * LOW-SCAFFOLD APPLICATION context: closer to a cold test than
   * homework, exercised in a novel setting. Optional — absent input
   * is byte-identical to pre-SPARK behavior.
   */
  spark?: SkillSparkObservation[];
}

export interface SkillStateResult {
  state: SkillLearningState;
  confidence: number; // 0-100 (UI renders soft words, never the number)
  observationCount: number;
  evidence: {
    drivers: string[]; // ordered, most load-bearing first
    metrics: Record<string, number | string | null>;
  };
  lastReteachOutcome: string | null;
}

// ── Zod schema for the evidence jsonb shape (spec §3) ────────────────
export const SkillStateEvidenceSchema = z.object({
  drivers: z.array(z.string()),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
});

// ─── WEIGHTS — pilot-tunable, change here only ──────────────
export const SKILL_STATE_WEIGHTS = {
  /** Anti-noise guard: never assert a verdict below this many graded observations. */
  MIN_OBSERVATIONS: 3,

  /** Cold accuracy at/above = mastery (mirrors the ≥80 locked band boundary). */
  ON_TRACK_COLD_ACCURACY: 0.8,

  /**
   * ready_to_extend (per-skill Enrich signal): sustained near-perfect
   * cold accuracy. INFORMATIONAL ONLY — never auto-promotes band or
   * generates harder work (no-success-streak-escalation lock); it
   * tells the teacher "this skill could go deeper", the teacher acts.
   */
  EXTEND_COLD_ACCURACY: 0.95,

  /** Cold-observation volume before the extend claim may fire. */
  EXTEND_MIN_COLD_OBSERVATIONS: 4,

  /** Cold accuracy below this is the "failing cold" floor for the NDI tests. */
  COLD_FLOOR: 0.5,

  /** Older-half → recent-half cold-accuracy delta that counts as "improving". */
  IMPROVING_DELTA: 0.15,

  /** Fraction of sessions with conceptual error pattern → "conceptual dominates". */
  CONCEPTUAL_DOMINANCE: 0.5,

  /** Fraction of sessions careless+procedural → "slips, not gaps". */
  SLIP_DOMINANCE: 0.5,

  /** HW-avg minus cold-accuracy×100 gap (pts) → scaffold-dependence divergence. */
  DIVERGENCE_GAP_PTS: 25,

  /** Share of struggling_trying homework labels supporting the divergence test. */
  STRUGGLING_SHARE: 0.4,

  /** Non-submission share at/above which the signature is an engagement gap. */
  NON_SUBMISSION_SHARE: 0.5,

  /** Minimum graded observations before NDI (the heavier claim) may fire. */
  NDI_MIN_OBSERVATIONS: 4,

  // ── SPARK evidence (low-scaffold application context) ──────
  // Interpretation rules, tuned during pilot:
  //   • SPARK is the LEAST scaffolded context we observe — a strong
  //     transfer score is strong evidence AGAINST
  //     needs_different_instruction (the student can apply the skill
  //     independently, even if homework looks rough). It SUPPRESSES
  //     the scaffold-vs-cold divergence driver and discounts NDI
  //     confidence when NDI fires anyway via the conceptual test.
  //   • Weak SPARK transfer on a skill the student passes in
  //     scaffolded homework STRENGTHENS the divergence signal — it
  //     can only ever be added on top of an already-fired NDI test,
  //     never initiate NDI on its own.
  //   • Improving transfer across ≥2 scored attempts is evidence for
  //     needs_more_time resolving on its own.
  //   • A single SPARK attempt NEVER flips a state by itself: SPARK
  //     enters as drivers/confidence adjustments on states the
  //     quiz/HW tests already reached, plus observation_count weight.
  //     The MIN_OBSERVATIONS guard counts all sources.
  //   • 'non_engaged' / 'minimal' content_quality completions are
  //     excluded entirely (engagement-guard parity).

  /** Transfer score (0-100) at/above = strong independent transfer. */
  SPARK_STRONG_TRANSFER: 70,

  /** Transfer score (0-100) below = weak transfer. Between = mixed. */
  SPARK_WEAK_TRANSFER: 50,

  /** First→last scored-attempt delta (pts) that counts as "improving". */
  SPARK_TREND_DELTA: 15,

  /** Confidence adjustment when SPARK evidence contradicts the state. */
  CONFIDENCE_SPARK_DISCOUNT: 10,

  /** Confidence floor after SPARK discounting — never below this. */
  CONFIDENCE_FLOOR: 10,

  /** Confidence assembly. */
  CONFIDENCE_PER_OBSERVATION: 8,   // × observation count, capped below
  CONFIDENCE_OBSERVATION_CAP: 40,
  CONFIDENCE_PER_DRIVER: 15,       // each agreeing signal
  CONFIDENCE_RETEACH_BONUS: 15,    // confirmed by reteach outcome
  CONFIDENCE_CAP: 95,              // never claim certainty
} as const;

const W = SKILL_STATE_WEIGHTS;

// ─── Main entry ─────────────────────────────────────────────

export function computeSkillState(input: SkillStateInput): SkillStateResult {
  const quiz = [...input.quiz].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const gradedHw = input.homework.filter((h) => h.submitted && typeof h.gradePct === 'number');

  // ── SPARK observations (low-scaffold application context) ──
  // Engagement filter first: non_engaged / minimal completions are
  // NOT skill evidence. Scored = has a transfer score (the analyzer
  // ran); completion-only records count as contact, not observation.
  const sparkUsable = (input.spark ?? []).filter(
    (s) => s.completed && s.contentQuality !== 'non_engaged' && s.contentQuality !== 'minimal',
  );
  const sparkScored = sparkUsable
    .filter((s) => typeof s.transferScore === 'number')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const observationCount = quiz.length + gradedHw.length + sparkScored.length;

  // ── not_attempted: zero contact ───────────────────────────
  // Raw spark contact (even a non-engaged completion) counts as
  // contact — engagement-guard parity sends it to insufficient_data
  // below, never back to not_attempted.
  if (observationCount === 0 && input.homework.length === 0 && (input.spark ?? []).length === 0) {
    return result('not_attempted', 0, 0, ['no_contact_with_skill'], {}, null);
  }

  // ── metrics ───────────────────────────────────────────────
  const coldAccuracy = quiz.length
    ? quiz.filter((q) => q.isCorrect).length / quiz.length
    : null;

  // Improvement: older half vs recent half of cold observations.
  let trendDelta: number | null = null;
  if (quiz.length >= 4) {
    const mid = Math.floor(quiz.length / 2);
    const acc = (xs: SkillQuizObservation[]) =>
      xs.filter((q) => q.isCorrect).length / xs.length;
    trendDelta = acc(quiz.slice(mid)) - acc(quiz.slice(0, mid));
  }

  const hwAvg = gradedHw.length
    ? gradedHw.reduce((s, h) => s + (h.gradePct as number), 0) / gradedHw.length
    : null;

  const divergencePts =
    hwAvg !== null && coldAccuracy !== null ? hwAvg - coldAccuracy * 100 : null;

  const patterns = input.sessionErrorPatterns.filter(
    (p) => p && p !== 'insufficient_data',
  );
  const conceptualShare = patterns.length
    ? patterns.filter((p) => p === 'conceptual').length / patterns.length
    : null;
  const slipShare = patterns.length
    ? patterns.filter((p) => p === 'careless' || p === 'procedural').length / patterns.length
    : null;

  const labeledHw = gradedHw.filter((h) => h.effortLabel);
  const strugglingShare = labeledHw.length
    ? labeledHw.filter((h) => h.effortLabel === 'struggling_trying').length / labeledHw.length
    : null;
  const independentSuccessShare = labeledHw.length
    ? labeledHw.filter((h) => h.effortLabel === 'independent_success').length / labeledHw.length
    : null;

  const nonSubmissionShare = input.homework.length
    ? input.homework.filter((h) => !h.submitted).length / input.homework.length
    : 0;

  // ── SPARK transfer metrics ────────────────────────────────
  const sparkAvg = sparkScored.length
    ? sparkScored.reduce((s, o) => s + (o.transferScore as number), 0) / sparkScored.length
    : null;
  const sparkTrendDelta =
    sparkScored.length >= 2
      ? (sparkScored[sparkScored.length - 1].transferScore as number) -
        (sparkScored[0].transferScore as number)
      : null;
  const sparkTransfer: 'strong' | 'weak' | 'mixed' | null =
    sparkAvg === null
      ? null
      : sparkAvg >= W.SPARK_STRONG_TRANSFER
        ? 'strong'
        : sparkAvg < W.SPARK_WEAK_TRANSFER
          ? 'weak'
          : 'mixed';

  const metrics: Record<string, number | string | null> = {
    cold_accuracy: round2(coldAccuracy),
    cold_observations: quiz.length,
    trend_delta: round2(trendDelta),
    hw_avg: round2(hwAvg),
    graded_hw: gradedHw.length,
    divergence_pts: round2(divergencePts),
    conceptual_share: round2(conceptualShare),
    slip_share: round2(slipShare),
    struggling_share: round2(strugglingShare),
    non_submission_share: round2(nonSubmissionShare),
  };
  // SPARK entries land in the evidence jsonb only when SPARK data
  // exists — absent keys keep pre-SPARK rows byte-identical.
  if (sparkUsable.length) {
    metrics.spark_attempts = sparkScored.length;
    metrics.spark_avg_transfer = round2(sparkAvg);
    metrics.spark_transfer = sparkTransfer;
    metrics.spark_trend_delta = round2(sparkTrendDelta);
  }

  // ── reteach outcome (computed against cold observations) ──
  const reteachOutcome = reteachOutcomeFor(input.reteach ?? null, quiz);
  if (reteachOutcome) metrics.last_reteach_outcome = reteachOutcome;

  // ── engagement guard: "didn't do it" is NOT "can't" ───────
  // Dominant non-submission with thin cold evidence = an engagement
  // signature. Never let it masquerade as a conceptual gap.
  // Checked BEFORE the MIN_OBSERVATIONS guard so the correct driver
  // fires even when observationCount < MIN_OBSERVATIONS.
  if (nonSubmissionShare >= W.NON_SUBMISSION_SHARE && quiz.length < W.MIN_OBSERVATIONS) {
    return result(
      'insufficient_data',
      20,
      observationCount,
      ['engagement_gap_not_skill_evidence'],
      metrics,
      reteachOutcome,
    );
  }

  // ── insufficient_data: anti-noise guard ───────────────────
  if (observationCount < W.MIN_OBSERVATIONS) {
    return result(
      'insufficient_data',
      Math.min(observationCount * 10, 30),
      observationCount,
      ['below_minimum_observations'],
      metrics,
      reteachOutcome,
    );
  }

  // ── ready_to_extend (per-skill Enrich — checked BEFORE on_track,
  //    it's the stronger positive claim) ───────────────────────
  if (
    coldAccuracy !== null &&
    quiz.length >= W.EXTEND_MIN_COLD_OBSERVATIONS &&
    coldAccuracy >= W.EXTEND_COLD_ACCURACY &&
    (trendDelta === null || trendDelta >= 0) &&
    nonSubmissionShare < W.NON_SUBMISSION_SHARE
  ) {
    const drivers = ['cold_accuracy_sustained_high'];
    if (independentSuccessShare !== null && independentSuccessShare >= 0.5) {
      drivers.push('independent_success_stable');
    }
    // Strong SPARK transfer agrees (independent application in a novel
    // context); weak transfer contradicts → confidence discount only,
    // the gate itself is unchanged.
    if (sparkTransfer === 'strong') drivers.push('spark_independent_transfer_strong');
    return result(
      'ready_to_extend',
      sparkDiscount(confidence(observationCount, drivers.length, false), sparkTransfer === 'weak'),
      observationCount,
      drivers,
      metrics,
      reteachOutcome,
    );
  }

  // ── on_track ──────────────────────────────────────────────
  if (
    coldAccuracy !== null &&
    coldAccuracy >= W.ON_TRACK_COLD_ACCURACY
  ) {
    const drivers = ['cold_accuracy_at_mastery'];
    if (independentSuccessShare !== null && independentSuccessShare >= 0.5) {
      drivers.push('independent_success_stable');
    }
    if (sparkTransfer === 'strong') drivers.push('spark_independent_transfer_strong');
    return result(
      'on_track',
      sparkDiscount(confidence(observationCount, drivers.length, false), sparkTransfer === 'weak'),
      observationCount,
      drivers,
      metrics,
      reteachOutcome,
    );
  }

  // ── needs_different_instruction (the heavier claim) ───────
  const ndiDrivers: string[] = [];
  if (observationCount >= W.NDI_MIN_OBSERVATIONS && nonSubmissionShare < W.NON_SUBMISSION_SHARE) {
    // Test 1: conceptual errors dominate AND practice isn't moving
    // the needle (flat/declining despite repeated attempts).
    if (
      conceptualShare !== null &&
      conceptualShare >= W.CONCEPTUAL_DOMINANCE &&
      coldAccuracy !== null &&
      coldAccuracy < W.ON_TRACK_COLD_ACCURACY &&
      (trendDelta === null || trendDelta < W.IMPROVING_DELTA)
    ) {
      ndiDrivers.push('conceptual_errors_dominate_without_improvement');
    }
    // Test 2: does fine with scaffolding, fails cold — plus visible
    // struggle in the scaffolded work.
    if (
      divergencePts !== null &&
      divergencePts >= W.DIVERGENCE_GAP_PTS &&
      coldAccuracy !== null &&
      coldAccuracy < W.COLD_FLOOR &&
      (strugglingShare === null || strugglingShare >= W.STRUGGLING_SHARE)
    ) {
      // Strong SPARK transfer SUPPRESSES this driver: the simulation
      // is an even lower-scaffold context than the quiz, and the
      // student carried the skill there — directly contradicting
      // "performs only with scaffolding". The contradiction is noted
      // in the evidence so the teacher "why" can cite it.
      if (sparkTransfer === 'strong') {
        metrics.spark_divergence_countered = 'strong_transfer';
      } else {
        ndiDrivers.push('scaffolded_work_lands_cold_assessment_does_not');
      }
    }
    // SPARK strengthener — STRENGTHENS only, never initiates: a weak
    // transfer score under a passing scaffolded-homework average is a
    // second independent low-scaffold context agreeing with the
    // divergence read. Gated on an existing NDI driver.
    if (
      ndiDrivers.length &&
      sparkTransfer === 'weak' &&
      hwAvg !== null &&
      sparkAvg !== null &&
      hwAvg - sparkAvg >= W.DIVERGENCE_GAP_PTS
    ) {
      ndiDrivers.push('spark_low_scaffold_transfer_weak');
    }
  }
  if (ndiDrivers.length) {
    // Two reteach outcomes CONFIRM the conceptual read: more-practice
    // failing to move cold accuracy (practice alone isn't enough),
    // and a different-approach reteach landing (the gap WAS
    // presentational — it's resolving; the improving observations
    // will move the state off NDI as they accumulate).
    const confirmed =
      reteachOutcome === 'more_practice_no_improvement' ||
      reteachOutcome === 'different_approach_improved';
    if (reteachOutcome === 'more_practice_no_improvement') {
      ndiDrivers.push('more_practice_did_not_move_cold_accuracy');
    }
    if (reteachOutcome === 'different_approach_improved') {
      ndiDrivers.push('different_approach_reteach_landing');
    }
    return result(
      'needs_different_instruction',
      // Strong SPARK transfer surviving to an NDI verdict (possible
      // via the conceptual test) is standing counter-evidence —
      // discount confidence rather than veto the quiz-driven read.
      sparkDiscount(confidence(observationCount, ndiDrivers.length, confirmed), sparkTransfer === 'strong'),
      observationCount,
      ndiDrivers,
      metrics,
      reteachOutcome,
    );
  }

  // ── needs_more_time ───────────────────────────────────────
  const nmtDrivers: string[] = [];
  if (trendDelta !== null && trendDelta >= W.IMPROVING_DELTA) {
    nmtDrivers.push('cold_accuracy_improving_with_practice');
  }
  if (slipShare !== null && slipShare >= W.SLIP_DOMINANCE) {
    nmtDrivers.push('errors_trend_careless_procedural_not_conceptual');
  }
  // Improving transfer across ≥2 scored SPARK attempts — the skill is
  // resolving on its own in the lowest-scaffold context we observe.
  if (sparkTrendDelta !== null && sparkTrendDelta >= W.SPARK_TREND_DELTA) {
    nmtDrivers.push('spark_transfer_improving');
  }
  if (
    divergencePts !== null &&
    Math.abs(divergencePts) < W.DIVERGENCE_GAP_PTS &&
    coldAccuracy !== null &&
    coldAccuracy >= W.COLD_FLOOR
  ) {
    nmtDrivers.push('no_scaffold_vs_cold_divergence');
  }
  if (nmtDrivers.length) {
    const confirmed = reteachOutcome === 'more_practice_improved';
    if (confirmed) nmtDrivers.push('more_practice_moved_cold_accuracy');
    // Strong transfer AGREES with "on the right track" (it is direct
    // evidence against an instruction problem) — added only on top of
    // already-fired NMT drivers, never as the initiating signal.
    if (sparkTransfer === 'strong') nmtDrivers.push('spark_independent_transfer_strong');
    return result(
      'needs_more_time',
      sparkDiscount(confidence(observationCount, nmtDrivers.length, confirmed), sparkTransfer === 'weak'),
      observationCount,
      nmtDrivers,
      metrics,
      reteachOutcome,
    );
  }

  // ── ambiguous middle ──────────────────────────────────────
  // Enough observations to say SOMETHING, but neither strong claim's
  // tests fired (e.g. flat-low accuracy with random errors). The
  // honest mild claim is needs_more_time at floor confidence — the
  // teacher panel renders this as "emerging" signal, and the next
  // few observations will move it.
  return result(
    'needs_more_time',
    25,
    observationCount,
    ['mixed_signals_default_mild'],
    metrics,
    reteachOutcome,
  );
}

// ─── Reteach confirmation loop ──────────────────────────────
// Compare cold accuracy BEFORE vs AFTER the reteach completion.
// Improvement after 'different_approach' confirms the conceptual
// read (a different presentation unlocked it); improvement after
// 'more_practice' confirms the pacing read. No-improvement after
// 'more_practice' is affirmative evidence FOR the conceptual read.
function reteachOutcomeFor(
  reteach: SkillReteachEvent | null,
  quizSorted: SkillQuizObservation[],
): string | null {
  if (!reteach) return null;
  const before = quizSorted.filter((q) => q.occurredAt < reteach.completedAt);
  const after = quizSorted.filter((q) => q.occurredAt >= reteach.completedAt);
  if (!before.length || !after.length) return `${reteach.type}_pending_cold_check`;
  const acc = (xs: SkillQuizObservation[]) =>
    xs.filter((q) => q.isCorrect).length / xs.length;
  const improved = acc(after) > acc(before);
  return `${reteach.type}_${improved ? 'improved' : 'no_improvement'}`;
}

// ─── helpers ────────────────────────────────────────────────

function confidence(obs: number, driverCount: number, reteachConfirmed: boolean): number {
  const base = Math.min(obs * W.CONFIDENCE_PER_OBSERVATION, W.CONFIDENCE_OBSERVATION_CAP);
  const drivers = driverCount * W.CONFIDENCE_PER_DRIVER;
  const bonus = reteachConfirmed ? W.CONFIDENCE_RETEACH_BONUS : 0;
  return Math.min(base + drivers + bonus, W.CONFIDENCE_CAP);
}

/**
 * SPARK contradiction discount: when the SPARK transfer read points
 * the OTHER way from the fused state, confidence drops by a fixed
 * amount (floored) — the state itself never changes on SPARK alone.
 */
function sparkDiscount(conf: number, contradicts: boolean): number {
  if (!contradicts) return conf;
  return Math.max(W.CONFIDENCE_FLOOR, conf - W.CONFIDENCE_SPARK_DISCOUNT);
}

function result(
  state: SkillLearningState,
  conf: number,
  observationCount: number,
  drivers: string[],
  metrics: Record<string, number | string | null>,
  lastReteachOutcome: string | null,
): SkillStateResult {
  return {
    state,
    confidence: Math.round(conf),
    observationCount,
    evidence: { drivers, metrics },
    lastReteachOutcome,
  };
}

function round2(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100;
}
