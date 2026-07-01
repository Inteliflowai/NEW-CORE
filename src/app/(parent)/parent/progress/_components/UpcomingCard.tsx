import React from 'react';
import { Card } from '@/components/core/Card';
import type { ParentProgressUpcoming } from '@/lib/parent/loadParentProgress';

export function UpcomingCard({ items }: { items: ParentProgressUpcoming[] }): React.JSX.Element {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Coming up</p>
        {items.length === 0 ? (
          <p className="text-fg-muted text-sm">No assignments coming up right now — a good place to be.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                {/* Title is a teacher/AI content identifier — rendered verbatim, not leak-guarded.
                    data-verbatim marks it so the leak test excludes it from the authored-prose scan
                    (a title like "Chapter 2" legitimately contains a digit). */}
                <span data-verbatim className="text-fg text-sm">{a.title}</span>
                <span className="text-fg-muted text-xs whitespace-nowrap">{a.dueLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default UpcomingCard;
