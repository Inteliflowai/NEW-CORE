import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentGrowth } from '@/lib/student/loadStudentGrowth';
import { growthLeadSentence, growthDirectionCopy } from '@/lib/copy/studentSkillLabel';
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { Card } from '@/components/core/Card';

export default async function StudentGrowthPage(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const data = await loadStudentGrowth(admin, userId);

  const lead = growthLeadSentence(data.gradeDirection);
  const dirSentence = growthDirectionCopy(data.gradeDirection);

  // Belt-and-suspenders: deterministic strings, but guard anyway.
  assertNoLeak(lead, 'StudentGrowthPage/lead');
  assertNoBannedWord(lead, 'StudentGrowthPage/lead');
  assertNoLeak(dirSentence, 'StudentGrowthPage/dirSentence');
  assertNoBannedWord(dirSentence, 'StudentGrowthPage/dirSentence');

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">How I&apos;m doing</h1>

      <p className="text-fg text-base leading-relaxed">{lead}</p>

      <Card>
        <div className="flex flex-col gap-2">
          <p className="text-fg text-xs font-bold uppercase tracking-wide">Grades over time</p>
          <GradeTrendSparkline
            points={data.trendPoints}
            ariaLabel="Your grade trend over time"
            coldStartLabel="Not enough graded work yet to show a trend."
          />
          {data.gradeDirection !== null && (
            <p className="text-fg-muted text-sm">{dirSentence}</p>
          )}
        </div>
      </Card>

      {data.skills.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">Your skills</p>
            <ul className="flex flex-col gap-2">
              {data.skills.map((s) => (
                <li key={s.skillName} className="flex items-center justify-between gap-2">
                  <span className="text-fg text-sm">{s.skillName}</span>
                  <span className="text-fg-muted text-xs">{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {data.latestHighFiveText && (
        <Card tone="brand">
          <div className="flex flex-col gap-2">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            <p className="text-fg text-sm leading-relaxed">{data.latestHighFiveText}</p>
            {data.totalHighFiveCount > 1 && (
              <Link href="/student/notes" className="text-brand text-xs underline">
                See all {data.totalHighFiveCount} notes →
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
