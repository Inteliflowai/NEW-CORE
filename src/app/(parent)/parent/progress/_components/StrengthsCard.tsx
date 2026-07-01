import React from 'react';
import { Card } from '@/components/core/Card';
import type { ParentProgressStrength } from '@/lib/parent/loadParentProgress';

export function StrengthsCard({
  firstName,
  strengths,
}: {
  firstName: string;
  strengths: ParentProgressStrength[];
}): React.JSX.Element | null {
  if (strengths.length === 0) return null;
  return (
    <Card tone="brand">
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">
          Areas where {firstName} is doing well
        </p>
        <ul className="flex flex-col gap-2">
          {strengths.map((s) => (
            <li key={s.skillName} className="flex items-center justify-between gap-2">
              {/* Skill name is a content identifier — verbatim (data-verbatim → excluded from
                  the authored-prose leak scan). Label is coach-safe ('Solid'/'Excelling'). */}
              <span data-verbatim className="text-fg text-sm">{s.skillName}</span>
              <span className="text-fg-muted text-xs">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default StrengthsCard;
