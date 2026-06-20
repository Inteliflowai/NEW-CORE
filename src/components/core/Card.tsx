/**
 * Card / StatCard — shared surface components.
 *
 * Styling is entirely token-driven via Tailwind utility classes.
 * No hardcoded hex. Intensity (loud/calm) is inherited from the nearest
 * ancestor with data-intensity="loud"|"calm" set by RoleLayout — the
 * Tier-3 token rebinding in globals.css reassigns --radius and --shadow,
 * so a loud Card automatically gets chunkier corners (0.75rem) and a
 * more elevated, brand-tinted shadow without any intensity prop or extra
 * globals.css rule.
 *
 * Pop-Art chrome: a hard ink edge (border-sidebar-edge) + offset sticker shadow
 * (shadow-sticker) + chunky corners (rounded-lg) give content cards the same
 * comic-panel energy as the rail, instead of a flat soft-shadow box. Both tokens
 * are role-neutral (ink-950 edge), so this reads as Pop-Art on any surface.
 *
 * Card utility classes: bg-surface rounded-lg border-2 border-sidebar-edge shadow-sticker p-5
 * StatCard label:       text-fg-muted text-xs font-medium uppercase tracking-wide
 * StatCard value:       text-fg text-2xl font-display font-bold leading-tight
 */

import type { ReactNode } from 'react';

const CARD_BASE = 'bg-surface rounded-lg border-2 border-sidebar-edge shadow-sticker p-5';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={[CARD_BASE, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function StatCard({ label, value, className }: StatCardProps) {
  return (
    <div className={[CARD_BASE, className].filter(Boolean).join(' ')}>
      <p className="text-fg-muted text-xs font-medium uppercase tracking-wide">{label}</p>
      <div className="text-fg text-2xl font-display font-bold leading-tight">{value}</div>
    </div>
  );
}

export default Card;
