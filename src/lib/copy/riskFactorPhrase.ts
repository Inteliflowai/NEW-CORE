// src/lib/copy/riskFactorPhrase.ts
//
// Render-boundary sanitizer for the teacher-facing roster "why" chip.
//
// computeRosterRiskIndex produces risk_factors[] strings that embed raw
// percentages / counts, e.g. "Low average quiz score (48%)" or
// "No submissions in the past 12 days". Rendering those verbatim puts a raw
// number on a stats surface, against the V2 stats-restraint principle. This
// turns a factor string into a words-only phrase. We sanitize at the RENDER
// boundary (not in the shared signal lib, which other consumers depend on).
//
// Contract: never throws, never lets a digit through (defensive fallback).

import { hasLeak } from './leakGuard';

export function riskFactorPhrase(factor: string): string {
  // 1. Drop any "(...)" numeric tail: "Low average quiz score (48%)" -> "Low average quiz score".
  let s = factor.replace(/\s*\([^)]*\)/g, '').trim();
  // 2. Rewrite the one inline-numeric factor: "No submissions in the past 12 days" -> "... recently".
  s = s.replace(/\bin the past\s+\d+\s+days?\b/i, 'recently');
  // 3. Defensive: if any digit somehow survives (a future factor shape), cut from the
  //    first digit, or fall back to a generic phrase — never leak, never throw.
  if (hasLeak(s)) {
    const stripped = s.replace(/\s*\d[\s\S]*$/, '').trim();
    s = stripped || 'Needs a closer look';
  }
  return s;
}
