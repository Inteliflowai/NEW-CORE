// Class-wide skill gaps — "N of M students need attention". Count-bearing prose (digits OK; banned-word-free).
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';

export interface SkillGap { skill_name: string; needs_count: number; total: number }

export function SkillsToFocus({ gaps }: { gaps: SkillGap[] }): React.JSX.Element | null {
  if (gaps.length === 0) return null; // quiet when none
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-3">
        <SectionLabel tone="warn">Skills to focus on</SectionLabel>
        <ul className="flex flex-col gap-2">
          {gaps.map((g) => (
            <li key={g.skill_name} className="flex items-baseline justify-between gap-3 text-fg">
              <span className="font-semibold">{g.skill_name}</span>
              <span className="text-fg text-sm whitespace-nowrap">{g.needs_count} of {g.total} need attention</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
export default SkillsToFocus;
