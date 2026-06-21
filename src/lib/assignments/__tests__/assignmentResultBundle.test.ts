// src/lib/assignments/__tests__/assignmentResultBundle.test.ts
import { describe, it, expect } from 'vitest';
import { assignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

const base = { masteryBand: 'advanced' as const, tier: 'middle' as const, firstName: 'Jordan', attemptId: 'attempt-1' };

describe('assignmentResultBundle', () => {
  it('carries the numeric grade for the student to see', () => {
    const b = assignmentResultBundle({ ...base, scorePct: 92, rawOverallFeedback: 'Nice synthesis.', rawTaskFeedback: [] });
    expect(b.gradePct).toBe(92);
  });

  it('coach message passes BOTH guards (no number, no banned word)', () => {
    // sweep several seeds/scores so a banned-word pool variant is exercised and re-guarded
    for (const scorePct of [95, 80, 65, 40]) {
      const b = assignmentResultBundle({ ...base, scorePct, rawOverallFeedback: 'ok', rawTaskFeedback: [] });
      expect(hasLeak(b.message.message)).toBe(false);
      expect(hasBannedWord(b.message.message)).toBe(false);
    }
  });

  it('sanitizes overall + per-task feedback that leaks a number OR a banned word', () => {
    const b = assignmentResultBundle({
      ...base, scorePct: 80,
      rawOverallFeedback: 'Your score model flags this as strong.', // banned words → replaced
      rawTaskFeedback: [
        { step: 1, feedback: 'Great reasoning connecting cause to effect.' }, // clean → kept
        { step: 2, feedback: 'You got 3 of 4 right.' },                        // digits → replaced
      ],
    });
    expect(hasLeak(b.overallFeedback)).toBe(false);
    expect(hasBannedWord(b.overallFeedback)).toBe(false);
    expect(b.taskFeedback[0].feedback).toContain('Great reasoning');
    expect(hasLeak(b.taskFeedback[1].feedback)).toBe(false);
  });
});
