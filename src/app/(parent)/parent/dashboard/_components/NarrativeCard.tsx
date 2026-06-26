'use client';
/**
 * NarrativeCard — the centerpiece of the parent dashboard.
 *
 * Renders the AI Learning Summary paragraphs as calm prose.
 * C1 (defense-in-depth): each paragraph is run through hasParentLeak at
 * render time; any that leaks is DROPPED before it reaches the DOM.
 * The engine already validates per-paragraph, but the render-time filter
 * is the final line of defense.
 *
 * Token-only typography; no hardcoded hex; calm parent-friendly styling.
 * All copy is DRAFT → Barb (STRINGS-FOR-BARB.md §Parent Dashboard).
 */
import React from 'react';
import { hasParentLeak } from '@/lib/copy/parentGuard';

export interface NarrativeCardProps {
  /** AI-generated paragraphs. Leaky ones are silently dropped at render. */
  paragraphs: string[];
}

export function NarrativeCard({ paragraphs }: NarrativeCardProps): React.JSX.Element {
  // C1: defense-in-depth filter — drop any paragraph that triggers parentLeaks
  const safeParagraphs = paragraphs.filter((p) => !hasParentLeak(p));

  return (
    <article
      aria-label="Learning summary"
      className="rounded-xl bg-surface p-6 flex flex-col gap-4"
    >
      <h2 className="font-display text-fg text-base font-semibold">
        Learning Summary
      </h2>
      {safeParagraphs.length === 0 ? (
        <p className="text-fg-muted text-sm leading-relaxed">
          We are still building your child's learning summary — check back soon.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {safeParagraphs.map((p, i) => (
            <p key={i} className="text-fg text-sm leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

export default NarrativeCard;
