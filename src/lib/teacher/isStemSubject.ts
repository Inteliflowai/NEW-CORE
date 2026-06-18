// ============================================================
// lib/teacher/isStemSubject.ts
//
// Classify a `lessons.subject` string as STEM or humanities for
// chapter test template selection. Per the locked decision (Marv
// 2026-05-06): humanities and STEM templates differ ONLY in
// section 5 — humanities ends with a Mini Essay (Power Paragraph,
// claim/evidence/explanation), STEM ends with a Multi-Step Problem
// (setup/given + work shown + result + interpret/verify). Sections
// 1-4 use the same shape with content shifted to the subject domain.
//
// Heuristic, not authoritative. Subject strings are free-text in
// CORE today (typed by teachers at lesson upload). When in doubt,
// default to humanities — it's the safer fallback because every
// subject can produce a coherent claim/evidence/explanation, while
// only STEM produces a coherent multi-step problem.
//
// Note: pickChapterTemplate / ChapterTestTemplate are out of scope
// for P2 — only isStemSubject is exported here.
// ============================================================

// Lowercase keyword set. Match anywhere in the lesson.subject string
// (case-insensitive). Designed conservatively — false-negatives bias
// toward humanities (the safe default) rather than the inverse.
const STEM_KEYWORDS: ReadonlySet<string> = new Set([
  // Pure math
  'math', 'mathematics', 'algebra', 'geometry', 'trigonometry',
  'calculus', 'precalculus', 'pre-calculus', 'statistics', 'stats',
  // Sciences
  'science', 'physics', 'chemistry', 'biology', 'earth science',
  'physical science', 'life science', 'environmental science',
  'astronomy', 'geology',
  // Computing / engineering
  'computer science', 'computing', 'programming', 'coding',
  'engineering', 'robotics',
  // Common abbreviations
  'cs', 'ap chem', 'ap bio', 'ap physics', 'ap calc', 'ap stat',
  'ap calculus', 'ap statistics',
]);

/**
 * Classify a single subject string as STEM. Returns false on
 * null/empty/unknown input (humanities is the safe default).
 *
 * Uses WORD-BOUNDARY matching, not substring. "Economics" and
 * "Civics" must NOT match the 'cs' abbreviation; "Mathematics"
 * MUST match the 'math' keyword. Word boundaries achieve both.
 */
// Subjects where "science" denotes a SOCIAL/humanities discipline, not a
// STEM lab science — the bare 'science' keyword must NOT classify these as
// STEM (caught by the math test-pass verifier 2026-06-16: a "Political
// Science" lesson was getting a math quiz). Genuine lab sciences (earth /
// physical / life / environmental / computer science) are NOT listed here,
// so they still match. We blank the matched phrase before STEM scanning, so
// a subject that ALSO carries a hard-STEM keyword still classifies as STEM.
const HUMANITIES_SCIENCE_RE =
  /\b(social|political|library|domestic|human|behaviou?ral|consumer|family|military|culinary|secretarial)\s+sciences?\b/g;

export function isStemSubject(subject: string | null | undefined): boolean {
  if (!subject || typeof subject !== 'string') return false;
  const lower = subject.toLowerCase().trim();
  if (!lower) return false;

  // Neutralize "<social> science" so its 'science' can't trigger STEM.
  const scanText = lower.replace(HUMANITIES_SCIENCE_RE, '$1 studies');

  // Direct match (full string).
  if (STEM_KEYWORDS.has(scanText)) return true;

  // Word-boundary match — handles "Algebra II", "AP Physics 1",
  // "Honors Biology", "Computer Science Principles" etc. WITHOUT
  // matching 'cs' inside 'economics'/'civics'/'physics' (the last
  // is intentional — "physics" itself is a separate keyword that
  // word-boundary-matches as a standalone word).
  for (const keyword of STEM_KEYWORDS) {
    // Build a fresh regex per keyword (cheap; STEM_KEYWORDS is small).
    // Escape any regex specials in the keyword and wrap in \b boundaries.
    // Scan the NEUTRALIZED text so a social-"science" subject can't match the
    // bare 'science' keyword (see HUMANITIES_SCIENCE_RE above).
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(scanText)) return true;
  }

  return false;
}
