// src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx
// TEACHER-ONLY. Left sticky "whole child" rail: storyLine, ONE priority CTA,
// then eyebrowed mini-cards (Mastery / Growing / At risk? / Effort).
//
// Leak discipline:
//   - storyLine / effortPhrase / riskFactorPhrase / trajectoryPhrase are words-only.
//   - RiskBadge gets the band; the raw risk_score is never passed/rendered.
//   - GrowthMotif gets growth_history (it normalises; numbers never render);
//     cold-start under 4 points is the component's own dignified state.
// Tokens only; content text-fg; eyebrows text-fg-muted.

import React from 'react';
import { Card } from '@/components/core/Card';
import { MasteryLabel } from '@/components/core/MasteryLabel';
import { GrowthMotif } from '@/components/core/GrowthMotif';
import { RiskBadge } from '@/components/core/RiskBadge';
import { effortPhrase } from '@/lib/copy/effortPhrase';
import { riskFactorPhrase } from '@/lib/copy/riskFactorPhrase';
import { trajectoryPhrase } from '@/lib/copy/trajectoryPhrase';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';
import type { PriorityCta } from '../_lib/priorityCta';
import { PriorityRecommendation } from './PriorityRecommendation';

interface WholeChildRailProps {
  signals: StudentSignals;
  storyLine: string;
  cta: PriorityCta;
  assignmentsHref: string;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-fg-muted text-xs font-medium uppercase tracking-wide mb-1">{children}</p>
  );
}

export function WholeChildRail({
  signals,
  storyLine,
  cta,
  assignmentsHref,
}: WholeChildRailProps): React.JSX.Element {
  const riskLevel = signals.risk.roster.risk_level;
  const topFactor = signals.risk.roster.risk_factors[0] ?? null;

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      {/* Whole-child narrative */}
      <p className="text-fg text-base">{storyLine}</p>

      {/* ONE deterministic priority recommendation (write deferred) */}
      <PriorityRecommendation cta={cta} assignmentsHref={assignmentsHref} />

      {/* Mastery */}
      <Card>
        <Eyebrow>Mastery</Eyebrow>
        <div className="flex flex-col gap-2">
          <MasteryLabel band={signals.current_band} />
          <p className="text-fg text-sm">{trajectoryPhrase(signals.trajectory.trajectory)}</p>
        </div>
      </Card>

      {/* Growing */}
      <Card>
        <Eyebrow>Growing</Eyebrow>
        <GrowthMotif growth_history={signals.growth_history} accent="ok" />
        <p className="text-fg-muted text-xs mt-2">vs your own past, never classmates</p>
      </Card>

      {/* At risk? — id is the scroll target for the review-risk priority CTA (#at-risk) */}
      <div id="at-risk">
        <Card>
          <Eyebrow>At risk?</Eyebrow>
          {riskLevel === 'low' ? (
            <p className="text-fg text-sm">Nothing flagged.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <RiskBadge band={riskLevel} />
              {topFactor && <p className="text-fg text-sm">△ {riskFactorPhrase(topFactor)}</p>}
            </div>
          )}
        </Card>
      </div>

      {/* Effort */}
      <Card>
        <Eyebrow>Effort</Eyebrow>
        <p className="text-fg text-sm">{effortPhrase(signals.effort.dominant_effort_pattern)}</p>
      </Card>
    </div>
  );
}

export default WholeChildRail;
