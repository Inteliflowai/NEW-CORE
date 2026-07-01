// NOTE: This component is intentionally retained but is no longer rendered on any
// route. The Parent Shell (C) spec swapped the dashboard's conversation-starter slot
// for HelpAtHomeCard; ConversationStarter is kept here for potential future reuse.
'use client';
/**
 * ConversationStarter — shows one conversation starter + a "more" affordance.
 *
 * C1 (defense-in-depth): every starter is run through hasParentLeak before
 * being shown. Any that leaks is silently dropped so only clean starters
 * appear in the DOM.
 *
 * "More" toggles to reveal additional clean starters. Token-only styling.
 * All copy is DRAFT → Barb (STRINGS-FOR-BARB.md §Parent Dashboard).
 */
import React, { useState } from 'react';
import { hasParentLeak } from '@/lib/copy/parentGuard';

export interface ConversationStarterProps {
  starters: string[];
}

export function ConversationStarter({ starters }: ConversationStarterProps): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);

  // C1: filter leaky starters before any render decision
  const safeStarters = starters.filter((s) => !hasParentLeak(s));

  if (safeStarters.length === 0) return <></>;

  const [first, ...rest] = safeStarters;

  return (
    <section aria-label="Conversation starter" className="rounded-xl bg-surface p-5 flex flex-col gap-3">
      <h2 className="font-display text-fg text-sm font-semibold uppercase tracking-wide">
        Try asking tonight
      </h2>
      <blockquote className="border-l-2 border-brand pl-4 text-fg text-sm leading-relaxed italic">
        {first}
      </blockquote>

      {rest.length > 0 && (
        <>
          {showAll && (
            <ul className="flex flex-col gap-2">
              {rest.map((s, i) => (
                <li
                  key={i}
                  className="border-l-2 border-fg-muted pl-4 text-fg-muted text-sm leading-relaxed italic"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="self-start text-brand text-xs font-medium hover:underline"
            aria-expanded={showAll}
          >
            {showAll ? 'Show less' : `${rest.length} more idea${rest.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </section>
  );
}

export default ConversationStarter;
