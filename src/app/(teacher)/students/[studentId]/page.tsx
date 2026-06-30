// src/app/(teacher)/students/[studentId]/page.tsx
// One Student — the richest teacher surface. Direction C "Skill Map" + a grafted
// priority-action rail. Destination of Roster's "look closer ›" link.
//
// READ-ONLY scope: all writes (High Five / Add note / Flag-for-reteach / Note /
// Extend) are DEFERRED — rendered but no mutation wired.
//
// Auth: the (teacher) layout already does requireRole(['teacher']). This page runs
// the object-level IDOR guard (guardStudentAccess) and, on failure, REDIRECTS to
// /roster (a Server Component cannot return a NextResponse). Then it uses the admin
// client to load signals + identity.
//
// Leak discipline (enforced by students/[studentId]/__tests__/student.leak.test.tsx):
//   - never render risk_score / session.score / consistency_score / raw confidence.
//   - growth_history only via GrowthMotif. skill_id NEVER printed (skill_name only).
//   - the only raw numbers allowed are the Assignment/quiz figures in divergencePhrase
//     and reteach deltas (teacher-only, this screen, by design).
//   - "Assignment", never "HW"/"Homework". Tokens only; content text-fg.

import React from 'react';
import { redirect } from 'next/navigation';

import { guardStudentAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentSignals } from '@/lib/signals/loadStudentSignals';
import { loadStudentIdentity } from '@/lib/signals/loadStudentIdentity';
import { loadStudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';
import { loadStudentQuizDetails } from '@/lib/signals/loadStudentQuizDetails';
import { storyLine } from '@/lib/copy/storyLine';
import { divergencePhrase } from '@/lib/copy/divergencePhrase';
import { misconceptionPhrase } from '@/lib/copy/misconceptionPhrase';
import { reteachWorkingPhrase } from '@/lib/copy/reteachWorkingPhrase';
import type { EffortLabel } from '@/lib/copy/effortPhrase';

import { IdentityHeader } from './_components/IdentityHeader';
import { WholeChildRail } from './_components/WholeChildRail';
import { SkillMapMatrix, type SkillMapRow } from './_components/SkillMapMatrix';
import { GradeTrendSection } from './_components/GradeTrendSection';
import { QuizDetailSection } from './_components/QuizDetailSection';
import { SectionLabel } from '../../_components/SectionLabel';
import { priorityCta } from './_lib/priorityCta';

export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ from?: string; class?: string }>;
}): Promise<React.JSX.Element> {
  const { studentId } = await params;
  const { from, class: classId } = await searchParams;

  // ── Object-level IDOR guard (layout already gated the teacher role) ──────────
  const guard = await guardStudentAccess(studentId);
  if (guard) {
    redirect('/roster');
  }

  // ── Data: signals + identity (identity is NOT in the signals payload) ────────
  const admin = createAdminSupabaseClient();
  const [signals, identity, gradeTrend, quizAttempts] = await Promise.all([
    loadStudentSignals(admin, studentId),
    loadStudentIdentity(admin, studentId),
    classId ? loadStudentGradeTrend(admin, { studentId, classId }) : Promise.resolve(null),
    loadStudentQuizDetails(admin, studentId),
  ]);

  // ── Breadcrumb (from ?from / ?class) ─────────────────────────────────────────
  const backHref = classId ? `/roster?class=${classId}` : '/roster';
  const backLabel = from === 'today' ? 'Today' : 'Roster';

  const fullName = identity?.full_name ?? 'Student';
  const gradeLevel = identity?.grade_level ?? null;

  // ── Whole-child narrative + priority CTA ─────────────────────────────────────
  const line = storyLine({
    effort: (signals.effort.dominant_effort_pattern as EffortLabel | null) ?? null,
    trajectory: signals.trajectory.trajectory,
    riskLevel: signals.risk.roster.risk_level,
  });

  const cta = priorityCta({
    riskLevel: signals.risk.roster.risk_level,
    perSkillCl: signals.per_skill_cl,
    divergenceFlagged: signals.divergence.divergence_flagged,
  });

  // ── Skill Map rows: join misconceptions to skills by skill_id ────────────────
  // (the skill_id is the join key only — it is NEVER rendered.)
  const misconceptionBySkill = new Map<string, string>();
  for (const m of signals.recurring_misconceptions) {
    if (m.recurring_error) {
      misconceptionBySkill.set(m.skill_id, misconceptionPhrase(m.recurring_error));
    }
  }
  const skillRows: SkillMapRow[] = signals.per_skill_cl.map((s) => ({
    ...s,
    misconception: s.skill_id ? misconceptionBySkill.get(s.skill_id) ?? null : null,
  }));

  // ── Bottom sections ──────────────────────────────────────────────────────────
  const showPattern = signals.divergence.divergence_flagged;
  const reteachWins = signals.reteach_outcomes;

  return (
    <div className="p-5 flex flex-col gap-5">
      <IdentityHeader
        fullName={fullName}
        gradeLevel={gradeLevel}
        classLabel={null}
        backHref={backHref}
        backLabel={backLabel}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* LEFT — whole-child rail (sticky) */}
        <aside className="w-full lg:w-80 shrink-0">
          <WholeChildRail
            signals={signals}
            storyLine={line}
            cta={cta}
          />
        </aside>

        {/* RIGHT — Skill Map + bottom sections */}
        <div className="flex flex-1 flex-col gap-5">
          <section className="flex flex-col gap-2.5">
            <h2><SectionLabel tone="brand">Skill Map</SectionLabel></h2>
            <SkillMapMatrix rows={skillRows} />
          </section>

          {gradeTrend && <GradeTrendSection trend={gradeTrend} studentName={fullName} />}

          {/* Quiz performance — teacher-only, shows mastery band + per-question */}
          <QuizDetailSection attempts={quizAttempts} />

          {/* A pattern worth knowing — only when divergence is flagged */}
          {showPattern && (
            <section id="pattern" className="flex flex-col gap-2">
              <h2><SectionLabel tone="warn">A pattern worth knowing</SectionLabel></h2>
              <p className="text-fg text-[13px] leading-snug">{divergencePhrase(signals.divergence)}</p>
            </section>
          )}

          {/* Reteach history */}
          {reteachWins.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2><SectionLabel tone="ok">Reteach history</SectionLabel></h2>
              <ul className="flex flex-col gap-1">
                {reteachWins.map((o) => {
                  const win = o.improvement > 0;
                  const delta = `${win ? '+' : ''}${Math.round(o.improvement)} pts`;
                  return (
                    <li
                      key={o.redo_attempt_id}
                      className="text-fg text-sm flex items-center gap-2"
                    >
                      <span aria-hidden="true" className={win ? 'text-ok' : 'text-fg-muted'}>
                        {win ? '✓' : '·'}
                      </span>
                      <span>
                        {reteachWorkingPhrase(win ? 'working' : null)} ({delta})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
