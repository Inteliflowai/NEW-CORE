'use client';
import React, { useState } from 'react';
import { Card } from '@/components/core/Card';
import { hasParentLeak } from '@/lib/copy/parentGuard';

const MAX_STARTERS = 3;

/** Conversation starters as a dedicated card, each with a copy button.
 *  Defense-in-depth: drops any starter that trips the parent guard. Hidden when
 *  none survive. Replaces the plain ConversationStarter on the dashboard. */
export function HelpAtHomeCard({ starters }: { starters: string[] }): React.JSX.Element | null {
  const safe = starters.filter((s) => !hasParentLeak(s)).slice(0, MAX_STARTERS);
  // Track the copied starter by its text (stable across a narrative refresh), not
  // by index over a filtered/sliced list, so the "Copied" state can't attach to the
  // wrong row when `starters` changes.
  const [copied, setCopied] = useState<string | null>(null);
  if (safe.length === 0) return null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      // Clipboard unavailable (older browser / denied) — no-op; the text is still visible.
    }
  };

  return (
    <Card tone="brand">
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Questions to start a conversation tonight</p>
        <ul className="flex flex-col gap-3">
          {safe.map((s) => (
            <li key={s} data-testid="starter-row" className="flex items-start justify-between gap-3">
              <span className="text-fg text-sm leading-relaxed">{s}</span>
              <button
                type="button"
                onClick={() => copy(s)}
                aria-label={`Copy: ${s}`}
                className="text-brand text-xs underline whitespace-nowrap shrink-0"
              >
                {copied === s ? 'Copied' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default HelpAtHomeCard;
