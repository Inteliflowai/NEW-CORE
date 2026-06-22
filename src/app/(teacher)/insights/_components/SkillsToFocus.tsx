// Class-wide skill gaps — soft words, never a fabricated count (mirrors roster ConceptGapsRail).
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';

export interface SkillGap { skill_name: string; phrase: string }

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
              <span className="text-fg text-sm whitespace-nowrap">{g.phrase} missed this</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
export default SkillsToFocus;
