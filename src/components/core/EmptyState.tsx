/**
 * EmptyState — first-class cold-start / empty states.
 *
 * Three variants for the three dignified states:
 *   'not-yet-assessed'   — cold start: no data yet
 *   'just-getting-started' — insufficient history for a trend (< 4 points)
 *   'on-track'           — things are fine; no action required
 *
 * Copy rules (SCOPE §15 / global constraints):
 *   - Observational, never diagnostic
 *   - Never fabricate a trend or score
 *   - Growth framed as "you vs your own past," never peer-relative
 *   - Struggle framed as "still building," never "struggle"
 *
 * Styling is token-driven via CSS class core-empty-state (globals.css).
 * No hardcoded hex.
 *
 * CSS contract (defined in globals.css):
 *   .core-empty-state {
 *     background: var(--surface);
 *     border-radius: var(--radius);
 *     padding: 2rem 1.5rem;
 *     text-align: center;
 *   }
 *   .core-empty-state-icon {
 *     color: var(--fg-muted);
 *     font-size: 2rem;
 *     margin-bottom: 0.75rem;
 *   }
 *   .core-empty-state-heading {
 *     color: var(--fg);
 *     font-family: var(--font-display);
 *     font-size: 1.125rem;
 *     font-weight: 600;
 *     margin-bottom: 0.5rem;
 *   }
 *   .core-empty-state-body {
 *     color: var(--fg-muted);
 *     font-size: 0.9375rem;
 *     line-height: 1.5;
 *     max-width: 28ch;
 *     margin: 0 auto;
 *   }
 */

export type EmptyStateVariant =
  | 'not-yet-assessed'
  | 'just-getting-started'
  | 'on-track';

const COPY: Record<EmptyStateVariant, { heading: string; body: string; icon: string }> = {
  'not-yet-assessed': {
    icon: '○',
    heading: 'Not yet assessed',
    body: 'Data will appear once practice is complete.',
  },
  'just-getting-started': {
    icon: '◇',
    heading: 'Just getting started',
    body: 'Keep going — more practice builds a clearer picture.',
  },
  'on-track': {
    icon: '◆',
    heading: "You're on track",
    body: 'Things look good here. Keep going.',
  },
};

interface EmptyStateProps {
  variant: EmptyStateVariant;
  className?: string;
}

export function EmptyState({ variant, className }: EmptyStateProps) {
  const { icon, heading, body } = COPY[variant];

  return (
    <div className={['core-empty-state', className].filter(Boolean).join(' ')}>
      <div className="core-empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="core-empty-state-heading">{heading}</h3>
      <p className="core-empty-state-body">{body}</p>
    </div>
  );
}

export default EmptyState;
