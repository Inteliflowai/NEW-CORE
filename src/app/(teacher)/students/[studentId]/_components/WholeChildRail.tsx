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
import { SectionLabel } from '../../../_components/SectionLabel';

interface WholeChildRailProps {
  signals: StudentSignals;
  storyLine: string;
  cta: PriorityCta;
}

type EyebrowTone = 'brand' | 'ok' | 'warn' | 'risk';

function Eyebrow({ children, tone }: { children: React.ReactNode; tone: EyebrowTone }) {
  return (
    <div className="mb-2">
      <SectionLabel tone={tone}>{children}</SectionLabel>
    </div>
  );
}

export function WholeChildRail({
  signals,
  storyLine,
  cta,
}: WholeChildRailProps): React.JSX.Element {
  const riskLevel = signals.risk.roster.risk_level;
  const topFactor = signals.risk.roster.risk_factors[0] ?? null;
  const atRiskTone: EyebrowTone = riskLevel === 'low' ? 'ok' : 'risk';

  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-5">
      {/* Whole-child narrative */}
      <p className="text-fg text-sm leading-snug">{storyLine}</p>

      {/* ONE deterministic priority recommendation (write deferred) */}
      <PriorityRecommendation cta={cta} />

      {/* Mastery */}
      <Card tone="brand">
        <Eyebrow tone="brand">Mastery</Eyebrow>
        <div className="flex flex-col gap-2">
          <MasteryLabel band={signals.current_band} />
          <p className="text-fg text-[13px]">{trajectoryPhrase(signals.trajectory.trajectory)}</p>
        </div>
      </Card>

      {/* Growing */}
      <Card tone="ok">
        <Eyebrow tone="ok">Growing</Eyebrow>
        <GrowthMotif growth_history={signals.growth_history} accent="ok" />
        <p className="text-fg-muted text-xs mt-2">vs your own past, never classmates</p>
      </Card>

      {/* At risk? — id is the scroll target for the review-risk priority CTA (#at-risk) */}
      <div id="at-risk">
        <Card tone={atRiskTone}>
          <Eyebrow tone={atRiskTone}>At risk?</Eyebrow>
          {riskLevel === 'low' ? (
            <p className="text-fg text-[13px]">Nothing flagged.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <RiskBadge band={riskLevel} />
              {topFactor && <p className="text-fg text-[13px]">△ {riskFactorPhrase(topFactor)}</p>}
            </div>
          )}
        </Card>
      </div>

      {/* Effort */}
      <Card tone="warn">
        <Eyebrow tone="warn">Effort</Eyebrow>
        <p className="text-fg text-[13px]">{effortPhrase(signals.effort.dominant_effort_pattern)}</p>
      </Card>
    </div>
  );
}

export default WholeChildRail;
