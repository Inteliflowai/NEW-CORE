// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { assignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';
import { AssignmentResultScreen } from '../AssignmentResultScreen';

it('shows the grade number but leaks nothing else', () => {
  const bundle = assignmentResultBundle({
    scorePct: 84,
    masteryBand: 'grade_level',
    tier: 'middle',
    firstName: 'Jordan',
    attemptId: 'a1',
    rawOverallFeedback: 'You connected the ideas well.',
    rawTaskFeedback: [{ step: 1, feedback: 'Clear reasoning.' }],
  });
  render(<AssignmentResultScreen result={bundle} />);

  // (1) the grade IS shown (allow-listed), in its dedicated element
  expect(screen.getByTestId('grade-display')).toHaveTextContent('84%');

  // (2) every NON-grade string is clean — assert per bundle string, not over the whole DOM
  for (const s of [
    bundle.message.message,
    bundle.message.teliMsg,
    bundle.overallFeedback,
    ...bundle.taskFeedback.map((t) => t.feedback),
  ]) {
    expect(hasLeak(s)).toBe(false);
    expect(hasBannedWord(s)).toBe(false);
  }
});
