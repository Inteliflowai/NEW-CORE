// src/components/core/GrowthMotif.tsx
// Signature growth viz: "you vs your own past" — stepped bars.
// Colors use --brand / --brand-accent CSS vars (set by role/intensity CSS binding in globals.css).
// loud vs calm handled by inherited data-intensity CSS selectors from RoleLayout — NOT a prop here.
// Never peer-relative; never fabricates a trend from <4 data points.

interface GrowthMotifProps {
  /** Ordered history of scores (oldest first). Must have ≥4 points to render bars. */
  history: number[];
  /** Optional copy shown below the bars (e.g. "+18 pts vs 4 weeks ago"). */
  deltaLabel?: string;
}

/** Minimum number of data points required to render the stepped bars. */
const COLD_START_THRESHOLD = 4;

/** Maximum value used for bar scaling ceiling. */
const SCALE_CEIL = 100;

function clamp(n: number): number {
  return Math.max(0, Math.min(SCALE_CEIL, n));
}

/**
 * GrowthMotif
 *
 * CORE's signature element: a stepped "you vs 4 weeks ago" growth visual.
 * Shows the student's own progress over time — never vs other students,
 * never a class rank, never a percentile. Observational, not diagnostic.
 *
 * With fewer than 4 history points, renders a dignified "just getting started"
 * empty state — never a flat/fake trend, never a fabricated delta.
 *
 * Intensity (loud / calm) is inherited from the nearest [data-intensity] ancestor
 * (set by RoleLayout). The component itself does not accept an intensity prop.
 * Student layouts bind --brand/--brand-accent to emerald/lime (loud, celebratory);
 * adult layouts bind them to the role accent (calm, restrained). Same component,
 * different hues via CSS token inheritance.
 */
export function GrowthMotif({ history, deltaLabel }: GrowthMotifProps) {
  const hasEnoughData = history.length >= COLD_START_THRESHOLD;

  if (!hasEnoughData) {
    return (
      <div
        className="growth-motif growth-motif--cold-start"
        data-testid="growth-motif-cold-start"
      >
        <p className="growth-motif__cold-start-label">just getting started</p>
      </div>
    );
  }

  const maxVal = Math.max(...history, 1);
  const scaleFactor = SCALE_CEIL / Math.max(maxVal, SCALE_CEIL);

  return (
    <div
      className="growth-motif"
      data-testid="growth-motif"
    >
      <div
        className="growth-motif__bars"
        aria-label="growth history bars"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.25rem',
          height: '4rem',
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius)',
          padding: '0.5rem',
        }}
      >
        {history.map((value, i) => {
          const heightPct = clamp(value * scaleFactor);
          const isLast = i === history.length - 1;
          return (
            <div
              key={i}
              role="presentation"
              className={`growth-motif__bar${isLast ? ' growth-motif__bar--current' : ''}`}
              style={{
                flex: 1,
                height: `${heightPct}%`,
                backgroundColor: isLast ? 'var(--brand)' : 'var(--brand-accent)',
                borderRadius: 'var(--radius)',
                minHeight: '2px',
              }}
            />
          );
        })}
      </div>
      {deltaLabel && (
        <p
          className="growth-motif__delta-label"
          style={{
            color: 'var(--fg)',
            marginTop: '0.25rem',
            fontSize: '0.75rem',
          }}
        >
          {deltaLabel}
        </p>
      )}
    </div>
  );
}

export default GrowthMotif;
