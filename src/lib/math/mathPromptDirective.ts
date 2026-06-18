// ============================================================
// lib/math/mathPromptDirective.ts
//
// Shared instruction appended to the content GENERATORS (quiz, homework,
// chapter test) so any math they produce is written in LaTeX delimiters
// that components/ui/MathText.tsx can typeset with KaTeX.
//
// Additive + format-only: it changes how math is WRITTEN, never what is
// asked or how hard it is — so it's orthogonal to difficulty/grading
// calibration. Inert for non-math (humanities) content, which stays plain.
//
// Delimiters MUST match MathText / lib/math/mathSegments.ts:
//   inline \( ... \)   block \[ ... \]   (bare $ is intentionally NOT math)
// ============================================================

export const MATH_FORMAT_DIRECTIVE = `
MATH FORMATTING (write math as math, not ASCII):
- Write EVERY mathematical expression — fractions, exponents, roots, symbols, equations, inequalities, formulas — in LaTeX.
- Inline math uses \\( ... \\). Display/block math uses \\[ ... \\].
- Examples: write \\(\\frac{3}{4}\\) not "3/4"; \\(x^2 + 1\\) not "x^2 + 1"; \\(\\sqrt{16}\\) not "sqrt(16)"; \\(\\frac{a}{b}\\) not "a/b"; \\[E = mc^2\\] for a standalone formula.
- Do NOT use a bare dollar sign for math (it is reserved for currency).
- This applies to question text, answer choices, rationales, worked steps, and any explanation.
- Plain prose with no math stays plain — do not wrap ordinary words in math delimiters.`;

/** Append the math-format directive to a generator system prompt. */
export function withMathFormatting(systemPrompt: string): string {
  return systemPrompt + '\n' + MATH_FORMAT_DIRECTIVE;
}
