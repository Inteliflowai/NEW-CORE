// src/lib/spark/contract.ts — pure CORE↔SPARK contract mappers (no I/O).
export type CoreBand = 'reteach' | 'grade_level' | 'advanced';
export type SparkBand = 'mastery' | 'developing' | 'struggling';
export type GradeBand = '3-5' | '6-8' | '9-12';

export interface RubricDimensions {
  problem_understanding: number | null;
  reasoning_strategy: number | null;
  use_of_evidence: number | null;
  creativity_application: number | null;
  communication: number | null;
  reflection_metacognition: number | null;
  collaboration: number | null;
}

const BAND_MAP: Record<CoreBand, SparkBand> = {
  advanced: 'mastery',
  grade_level: 'developing',
  reteach: 'struggling',
};

export function bandToSparkBand(band: CoreBand): SparkBand {
  return BAND_MAP[band];
}

/** Map a CORE grade to a SPARK grade_band. null = K-2 / unparseable (SPARK rejects K-2). */
export function gradeToBand(grade: string | number | null | undefined): GradeBand | null {
  if (grade == null) return null;
  const m = String(grade).match(/\d{1,2}/);
  if (!m) return null;
  const n = Number(m[0]);
  if (n >= 3 && n <= 5) return '3-5';
  if (n >= 6 && n <= 8) return '6-8';
  if (n >= 9 && n <= 12) return '9-12';
  return null;
}

/** transfer_score = avg(non-null rubric dims) × 25, else fall back to score. Rounded int, or null. */
export function computeTransferScore(
  rubric: Partial<RubricDimensions> | null | undefined,
  score: number | null | undefined,
): number | null {
  if (rubric) {
    const vals = Object.values(rubric).filter((v): v is number => typeof v === 'number');
    if (vals.length > 0) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.round(avg * 25);
    }
  }
  return typeof score === 'number' ? Math.round(score) : null;
}

/** Teacher-facing word for a transfer score. SPARK thresholds: 70 strong, 50 developing. */
export function transferWord(score: number | null | undefined): string {
  if (typeof score !== 'number') return 'not yet scored';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'developing';
  return 'emerging';
}
