// src/app/(teacher)/insights/_components/ComprehensionBySkill.tsx
// Whole-class comprehension, one row per skill that needs attention. The tally uses the 3
// teacher verbs only. Native <details> reveals who sits in each bucket; each name links to that
// student's existing Skill Map. Teacher-only; quiet when nothing needs attention.
import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import type { SkillComprehension, StudentRef } from '@/lib/insights/loadClassComprehension';

function NameList({ label, students, classId }: { label: string; students: StudentRef[]; classId: string }): React.JSX.Element | null {
  if (students.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg text-xs font-semibold uppercase tracking-wide">{label}</span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {students.map((s) => (
          <li key={s.student_id}>
            <Link
              href={`/students/${s.student_id}?class=${classId}`}
              className="text-brand text-sm underline-offset-2 hover:underline"
            >
              {s.full_name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComprehensionBySkill({
  skills,
  classId,
}: { skills: SkillComprehension[]; classId: string }): React.JSX.Element | null {
  if (skills.length === 0) return null; // quiet when nothing needs attention
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-3">
        <SectionLabel tone="warn">Comprehension by skill</SectionLabel>
        <ul className="flex flex-col gap-3">
          {skills.map((s) => (
            <li key={s.skill_id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 text-fg">
                  <span className="font-semibold">{s.skill_name}</span>
                  <span className="text-fg text-sm whitespace-nowrap">
                    {s.reinforce} Reinforce · {s.on_track} On Track · {s.enrich} Enrich
                  </span>
                  <span className="text-fg-muted ml-auto text-xs group-open:hidden">See who</span>
                  <span className="text-fg-muted ml-auto hidden text-xs group-open:inline">Hide</span>
                </summary>
                <div className="mt-2 flex flex-col gap-2 pl-1">
                  <NameList label="Reinforce" students={s.reinforce_students} classId={classId} />
                  <NameList label="On Track" students={s.on_track_students} classId={classId} />
                  <NameList label="Enrich" students={s.enrich_students} classId={classId} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
export default ComprehensionBySkill;
