/**
 * Card / StatCard — shared surface components.
 *
 * Styling is entirely token-driven via CSS classes defined in globals.css.
 * No hardcoded hex. Intensity (loud/calm) is inherited from the nearest
 * ancestor with data-intensity="loud"|"calm" set by RoleLayout.
 *
 * CSS contract (defined in globals.css):
 *   .core-card {
 *     background: var(--surface);
 *     border-radius: var(--radius);
 *     box-shadow: var(--shadow);
 *     padding: 1.25rem;
 *   }
 *   [data-intensity="loud"] .core-card {
 *     border-radius: var(--radius-lg);
 *     box-shadow: var(--shadow-pop);
 *   }
 *   .core-stat-label {
 *     color: var(--fg-muted);
 *     font-size: 0.75rem;
 *     font-weight: 500;
 *     letter-spacing: 0.05em;
 *     text-transform: uppercase;
 *   }
 *   .core-stat-value {
 *     color: var(--fg);
 *     font-size: 1.5rem;
 *     font-weight: 700;
 *     line-height: 1.2;
 *   }
 */

import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={['core-card', className].filter(Boolean).join(' ')}>
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
    <div className={['core-card', className].filter(Boolean).join(' ')}>
      <p className="core-stat-label">{label}</p>
      <div className="core-stat-value">{value}</div>
    </div>
  );
}

export default Card;
