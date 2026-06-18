// ============================================================
// lib/math/checkNumericAnswer.ts
//
// Deterministic numeric-answer checker for math questions (Phase 1 / 7a).
//
// Grades a student's numeric answer by VALUE, not by string match — so
// 1/2, 0.5, 2/4 and 50% all count as correct for an answer of 0.5. Runs
// in code (no LLM), so it's instant, exact, free, and identical every time.
//
// Deliberately NOT an expression evaluator: it parses a single number
// written in the common forms a K-12 student types. There is NO eval / no
// arbitrary arithmetic — anything it doesn't recognize returns null
// (unparseable) rather than guessing, which keeps it safe and predictable.
//
// Supported input forms (after trimming):
//   integer            42        -7      +3
//   decimal            3.14      .5      -0.25
//   scientific         1.5e3     2E-4
//   fraction           3/4       -1/2    1.5/3
//   mixed number       1 1/2     -2 3/4   (whole + fraction = 1.5, -2.75)
//   percent (any form) 50%       0.5%    1/4%   (value ÷ 100)
//
// Percent is parsed consistently on BOTH the student answer and the
// accepted answer(s), so "50%" and "0.5" compare equal as long as the
// author writes the accepted value the way they expect students to.
// ============================================================

export interface NumericCheckSpec {
  /**
   * The correct value(s), written the way a student might type them
   * (e.g. ['0.5'] or ['1/2', '0.5']). Each is parsed to a number; the
   * student is correct if they match ANY of them within tolerance.
   */
  accepted: string[];
  /**
   * Absolute tolerance for the comparison. Default 1e-9 (absorbs float
   * error like 0.1 + 0.2). Set this when the question allows rounding —
   * e.g. "round to 2 decimals" → tolerance 0.005. A relative floor of
   * 1e-9 * |accepted| is also applied so very large answers still match.
   */
  tolerance?: number;
}

export type NumericCheckReason = 'match' | 'mismatch' | 'unparseable' | 'empty' | 'no_accepted';

export interface NumericCheckResult {
  correct: boolean;
  /** The student's parsed numeric value, or null if it couldn't be parsed. */
  parsedStudent: number | null;
  reason: NumericCheckReason;
}

/**
 * Parse a single numeric answer string into a number. Returns null for
 * anything not in the supported forms (letters, words, multiple numbers,
 * arithmetic expressions, empty). Never throws.
 */
export function parseNumeric(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // Percent: strip a single trailing %, parse the rest, divide by 100.
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
    if (s === '') return null;
  }

  const value = parseCore(s);
  if (value === null) return null;
  return percent ? value / 100 : value;
}

/** Parse the non-percent core: mixed number, fraction, or plain number. */
function parseCore(s: string): number | null {
  // Mixed number: "1 1/2", "-2 3/4" (whole and fraction share a sign).
  const mixed = s.match(/^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const sign = mixed[1] === '-' ? -1 : 1;
    const whole = Number(mixed[2]);
    const num = Number(mixed[3]);
    const den = Number(mixed[4]);
    if (den === 0) return null;
    return sign * (whole + num / den);
  }

  // Fraction: "3/4", "-1/2", "1.5/3" (decimals allowed on each side).
  const frac = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+))$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (!isFinite(num) || !isFinite(den) || den === 0) return null;
    return num / den;
  }

  // Plain number: integer, decimal, or scientific notation.
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  return null;
}

/**
 * Check a student's numeric answer against the accepted value(s).
 * Pure + deterministic; safe to run on any user input.
 */
export function checkNumericAnswer(
  studentRaw: string,
  spec: NumericCheckSpec,
): NumericCheckResult {
  if (studentRaw == null || String(studentRaw).trim() === '') {
    return { correct: false, parsedStudent: null, reason: 'empty' };
  }
  if (!spec || !Array.isArray(spec.accepted) || spec.accepted.length === 0) {
    return { correct: false, parsedStudent: null, reason: 'no_accepted' };
  }

  const student = parseNumeric(studentRaw);
  if (student === null) {
    return { correct: false, parsedStudent: null, reason: 'unparseable' };
  }

  const tol = spec.tolerance != null && spec.tolerance >= 0 ? spec.tolerance : 1e-9;

  for (const acc of spec.accepted) {
    const a = parseNumeric(acc);
    if (a === null) continue; // skip a malformed accepted value rather than crash
    const allowed = Math.max(tol, 1e-9 * Math.abs(a));
    if (Math.abs(student - a) <= allowed) {
      return { correct: true, parsedStudent: student, reason: 'match' };
    }
  }

  return { correct: false, parsedStudent: student, reason: 'mismatch' };
}
