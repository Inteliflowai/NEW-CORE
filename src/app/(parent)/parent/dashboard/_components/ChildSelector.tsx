'use client';
/**
 * ChildSelector — shows a tab-style selector when the parent has >1 child.
 * Each child is a link setting ?child=<id>. The selected child is highlighted.
 * Parent-safe: only shows first names, no diagnostic content.
 * Token-only styling; no hardcoded hex.
 */
import React from 'react';

export interface ChildSelectorChild {
  id: string;
  firstName: string;
}

export interface ChildSelectorProps {
  children: ChildSelectorChild[];
  selectedId: string;
}

export function ChildSelector({ children, selectedId }: ChildSelectorProps): React.JSX.Element {
  return (
    <nav aria-label="Select a child" className="flex gap-2 flex-wrap">
      {children.map((child) => {
        const isSelected = child.id === selectedId;
        return (
          <a
            key={child.id}
            href={`?child=${encodeURIComponent(child.id)}`}
            aria-current={isSelected ? 'page' : undefined}
            className={[
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              isSelected
                ? 'bg-brand text-surface'
                : 'bg-surface text-fg border border-fg-muted hover:border-brand',
            ].join(' ')}
          >
            {child.firstName}
          </a>
        );
      })}
    </nav>
  );
}

export default ChildSelector;
