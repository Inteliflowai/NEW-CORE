// ReportCard — pure presentational component for the printable parent report.
//
// NEVER import loadStudentSignals, loadStudentGradeTrend, or any diagnostic loader.
// Four-audience safety: every string rendered is pre-checked via hasParentLeak.
// The direction WORDS (climbing/steady/sliding) are translated into warm temporal
// phrases here — no digits, no "compared to", no peer framing.
import { hasParentLeak } from '@/lib/copy/parentGuard';
import type { ParentReport } from '@/lib/parent/perChildReportData';

// ── Direction helpers (warm temporal phrases, all verified parent-safe) ────────

/**
 * Warm phrase for the PRIOR window direction.
 * Used in: "Earlier in the term, {name}'s work was {priorPhrase}."
 */
function priorPhrase(d: 'climbing' | 'steady' | 'sliding'): string {
  if (d === 'climbing') return 'building momentum';
  if (d === 'steady') return 'holding steady';
  return 'working through some hurdles';
}

/**
 * Warm phrase for the RECENT window direction.
 * Used in: "Over the past few weeks, they've been {recentPhrase}."
 */
function recentPhrase(d: 'climbing' | 'steady' | 'sliding'): string {
  if (d === 'climbing') return 'building real momentum';
  if (d === 'steady') return 'staying consistent';
  return 'working through some challenges';
}

/**
 * Compose a temporal comparison sentence. All output is warm direction-word only.
 * No digits, no "compared to", no peer framing.
 */
function buildComparisonSentence(report: ParentReport): string | null {
  const { firstName, recentDirection, priorDirection } = report;
  if (!recentDirection) return null;

  if (priorDirection) {
    return (
      `Earlier in the term, ${firstName}'s work was ${priorPhrase(priorDirection)}. ` +
      `Over the past few weeks, they've been ${recentPhrase(recentDirection)}.`
    );
  }

  return `${firstName} has been ${recentPhrase(recentDirection)} in their recent work.`;
}

// ── Learning-style phrase ──────────────────────────────────────────────────────

function learningStylePhrase(firstName: string, style: string): string {
  return `${firstName} tends to engage well with ${style} learning activities.`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportCard({ report }: { report: ParentReport }) {
  const { firstName, hasEnoughData, learningStyleLabel, recentTopics } = report;

  // Build and guard the comparison sentence
  const raw = buildComparisonSentence(report);
  const comparisonSentence = raw && !hasParentLeak(raw) ? raw : null;

  // Guard learning-style phrase
  const lsPhrase = learningStyleLabel
    ? learningStylePhrase(firstName, learningStyleLabel)
    : null;
  const safeStylePhrase = lsPhrase && !hasParentLeak(lsPhrase) ? lsPhrase : null;

  // Guard each topic individually
  const safeTopics = recentTopics.filter((t) => !hasParentLeak(t));

  return (
    <div className="flex flex-col gap-8">
      {/* Learning Journey */}
      <section aria-labelledby="report-journey-heading">
        <h2
          id="report-journey-heading"
          className="font-display text-fg text-base font-semibold mb-3"
        >
          Learning Journey
        </h2>
        {hasEnoughData && comparisonSentence ? (
          <p className="text-fg text-sm leading-relaxed">{comparisonSentence}</p>
        ) : (
          <p className="text-fg-muted text-sm leading-relaxed">
            We&apos;re still building a picture of {firstName}&apos;s learning journey.
            Check back in a few weeks to see how things are going.
          </p>
        )}
      </section>

      {/* How They Learn */}
      {safeStylePhrase && (
        <section aria-labelledby="report-style-heading">
          <h2
            id="report-style-heading"
            className="font-display text-fg text-base font-semibold mb-3"
          >
            How {firstName} Learns
          </h2>
          <p className="text-fg text-sm leading-relaxed">{safeStylePhrase}</p>
        </section>
      )}

      {/* Recent Topics */}
      {safeTopics.length > 0 && (
        <section aria-labelledby="report-topics-heading">
          <h2
            id="report-topics-heading"
            className="font-display text-fg text-base font-semibold mb-3"
          >
            Topics {firstName} Has Been Exploring
          </h2>
          <ul className="flex flex-col gap-1" role="list">
            {safeTopics.map((topic) => (
              <li key={topic} className="text-fg text-sm flex items-center gap-2">
                <span aria-hidden="true" className="text-brand">·</span>
                {topic}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
