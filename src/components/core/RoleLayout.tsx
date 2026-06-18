// src/components/core/RoleLayout.tsx
// Pure presentational role shell — sets data-role + data-intensity on the root,
// renders the ◆ CORE mark and an optional nav slot.
// Route-group layouts (4b–4e) import from here.

import React from 'react';

export type Role = 'student' | 'teacher' | 'parent' | 'admin' | 'super-admin';

function intensityFor(role: Role): 'loud' | 'calm' {
  return role === 'student' ? 'loud' : 'calm';
}

interface RoleLayoutProps {
  role: Role;
  /** Optional navigation rendered inside the header beside the mark. */
  nav?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * RoleLayout
 *
 * Sets data-role + data-intensity on its root <div> so every descendant
 * component can read the correct Tier-2 CSS token values without prop-drilling.
 *
 * student → data-intensity="loud"
 * teacher | parent | admin | super-admin → data-intensity="calm"
 */
export function RoleLayout({ role, nav, children }: RoleLayoutProps) {
  const intensity = intensityFor(role);

  return (
    <div
      data-role={role}
      data-intensity={intensity}
      className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]"
    >
      <header className="flex items-center gap-4 px-6 py-4 border-b border-[var(--surface)]">
        <span
          aria-label="CORE"
          className="font-display font-bold text-[var(--brand)] tracking-tight select-none"
        >
          ◆ CORE
        </span>
        {nav && (
          <nav className="flex-1" aria-label="Role navigation">
            {nav}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default RoleLayout;
