// src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts
//
// Deterministic ONE priority recommendation for the whole-child rail.
// Precedence (first match wins):
//   1. roster risk high/critical          → "Review what's going on"
//   2. a top Reinforce skill exists        → "Reinforce {skill} — see Gradebook"
//   3. divergence flagged                  → "Leave a note"
//   4. else                                → "Open Assignments"
//
// The recommendation is text + an optional anchor/href. The WRITE is deferred —
// the page renders it as a suggestion, it does not perform a mutation.

import type { RiskBand } from '@/lib/copy/riskBandLabel';
import type { PerSkillCL } from '@/lib/signals/loadStudentSignals';

export type PriorityCtaKind = 'review-risk' | 'flag-reteach' | 'leave-note' | 'open-assignments';

export interface PriorityCta {
  kind: PriorityCtaKind;
  label: string;
  /** Optional in-page anchor (e.g. '#skill-map') the recommendation points at. */
  anchor?: string;
  /** The skill_name when kind === 'flag-reteach'. */
  skillName?: string;
}

export interface PriorityCtaInput {
  riskLevel: RiskBand;
  perSkillCl: Pick<PerSkillCL, 'cl_verb' | 'skill_name'>[];
  divergenceFlagged: boolean;
}

export function priorityCta(input: PriorityCtaInput): PriorityCta {
  if (input.riskLevel === 'high' || input.riskLevel === 'critical') {
    return { kind: 'review-risk', label: "Review what's going on", anchor: '#at-risk' };
  }

  const topReinforce = input.perSkillCl.find((s) => s.cl_verb === 'Reinforce');
  if (topReinforce) {
    return {
      kind: 'flag-reteach',
      label: `Reinforce ${topReinforce.skill_name} — see Gradebook`,
      anchor: '/gradebook',
      skillName: topReinforce.skill_name,
    };
  }

  if (input.divergenceFlagged) {
    return { kind: 'leave-note', label: 'Leave a note', anchor: '#pattern' };
  }

  return { kind: 'open-assignments', label: 'Open Assignments' };
}
