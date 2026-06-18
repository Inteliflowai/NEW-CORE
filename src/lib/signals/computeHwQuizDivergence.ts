/**
 * CORE V2 — HW vs Quiz Divergence Signal Computation
 * Verbatim lift from V1 lib/signals/computeHwQuizDivergence.ts
 *
 * divergence_score:     0–100 (magnitude of gap, normalised)
 * divergence_direction: 'hw_higher' | 'quiz_higher' | 'aligned'
 * divergence_trend:     'widening' | 'narrowing' | 'stable' | null
 */

export type DivergenceDirection = 'hw_higher' | 'quiz_higher' | 'aligned';
export type DivergenceTrend     = 'widening' | 'narrowing' | 'stable';

export interface DivergenceResult {
  divergence_score:     number;
  divergence_direction: DivergenceDirection;
  divergence_trend:     DivergenceTrend | null;
  hw_avg:               number | null;
  quiz_avg:             number | null;
}

export interface DivergenceInputData {
  /** Graded hw scores 0–100, newest first (from DB ORDER DESC) */
  homeworkScores: (number | null)[];
  /** Graded quiz scores 0–100, newest first */
  quizScores:     (number | null)[];
}

const MIN_HW_SAMPLES      = 2;
const MIN_QUIZ_SAMPLES    = 1;
const ALIGNMENT_THRESHOLD = 10;

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Splits scores into thirds chronologically and computes whether
 * the HW-quiz gap is widening, narrowing, or stable over time.
 */
function computeTrend(
  hwChron: number[],   // oldest → newest
  quizChron: number[]  // oldest → newest
): DivergenceTrend | null {
  if (hwChron.length < 3 || quizChron.length < 3) return null;

  function windows(arr: number[]): number[][] {
    const size = Math.ceil(arr.length / 3);
    return [
      arr.slice(0, size),
      arr.slice(size, size * 2),
      arr.slice(size * 2),
    ].filter((w) => w.length > 0);
  }

  const hwW  = windows(hwChron);
  const qzW  = windows(quizChron);
  const n    = Math.min(hwW.length, qzW.length);
  if (n < 2) return null;

  const gaps      = Array.from({ length: n }, (_, i) => avg(hwW[i]) - avg(qzW[i]));
  const firstHalf  = avg(gaps.slice(0, Math.floor(n / 2)));
  const secondHalf = avg(gaps.slice(Math.ceil(n / 2)));

  const absFirst  = Math.abs(firstHalf);
  const absSecond = Math.abs(secondHalf);

  if (Math.abs(absSecond - absFirst) < 3) return 'stable';
  return absSecond > absFirst ? 'widening' : 'narrowing';
}

export function computeHwQuizDivergence(data: DivergenceInputData): DivergenceResult {
  const hwGraded   = data.homeworkScores.filter((s): s is number => s !== null);
  const quizGraded = data.quizScores.filter((s): s is number => s !== null);

  if (hwGraded.length < MIN_HW_SAMPLES || quizGraded.length < MIN_QUIZ_SAMPLES) {
    return {
      divergence_score:     0,
      divergence_direction: 'aligned',
      divergence_trend:     null,
      hw_avg:               hwGraded.length ? Math.round(avg(hwGraded)) : null,
      quiz_avg:             quizGraded.length ? Math.round(avg(quizGraded)) : null,
    };
  }

  const hw_avg   = avg(hwGraded);
  const quiz_avg = avg(quizGraded);
  const gap      = hw_avg - quiz_avg;

  // Reverse to chronological for trend (DB gives newest first)
  const divergence_trend = computeTrend(
    [...hwGraded].reverse(),
    [...quizGraded].reverse()
  );

  if (Math.abs(gap) <= ALIGNMENT_THRESHOLD) {
    return {
      divergence_score:     Math.round(Math.abs(gap)),
      divergence_direction: 'aligned',
      divergence_trend,
      hw_avg:               Math.round(hw_avg),
      quiz_avg:             Math.round(quiz_avg),
    };
  }

  const divergence_score:     number             = Math.round(Math.min(100, (Math.abs(gap) / 50) * 100));
  const divergence_direction: DivergenceDirection = gap > 0 ? 'hw_higher' : 'quiz_higher';

  return { divergence_score, divergence_direction, divergence_trend, hw_avg: Math.round(hw_avg), quiz_avg: Math.round(quiz_avg) };
}
