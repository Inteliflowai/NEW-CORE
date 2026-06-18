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
 * Styling is token-driven via Tailwind utility classes. No hardcoded hex.
 * Intensity (loud/calm) is inherited from the nearest [data-intensity] ancestor
 * set by RoleLayout — the Tier-3 rebinding in globals.css adjusts --radius
 * and --shadow so loud/calm surfaces differ automatically.
 *
 * Layout utility classes: bg-surface rounded p-8 text-center
 * Icon:                   text-fg-muted text-3xl mb-3
 * Heading:                text-fg font-display text-lg font-semibold mb-2
 * Body:                   text-fg-muted text-base leading-relaxed max-w-[28ch] mx-auto
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
    <div className={['bg-surface rounded p-8 text-center', className].filter(Boolean).join(' ')}>
      <div className="text-fg-muted text-3xl mb-3" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-fg font-display text-lg font-semibold mb-2">{heading}</h3>
      <p className="text-fg-muted text-base leading-relaxed max-w-[28ch] mx-auto">{body}</p>
    </div>
  );
}

export default EmptyState;
