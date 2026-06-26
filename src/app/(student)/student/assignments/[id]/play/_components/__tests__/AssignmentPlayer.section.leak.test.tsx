// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { hasDiagnosticVocab } from '@/lib/copy/leakGuard';
import AssignmentPlayer from '@/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer';
import type { ResponsesShape } from '@/lib/assignments/loadAssignmentForPlay';

const GRADED_BODY = {
  attempt_id: 'att1',
  result: {
    gradePct: 84,
    masteryLabel: 'Strong',
    message: { message: 'Nice!', teliMsg: 'Nice!', teliState: 'idle' as const },
    overallFeedback: 'Good.',
    taskFeedback: [{ step: 1, feedback: 'Clear.' }],
  },
};

function stubFetch(body: unknown = GRADED_BODY) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', stubFetch());
  if (typeof window !== 'undefined') window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssignmentPlayer section headings (four-audience)', () => {
  // content.tasks carries two distinct skills; an adversarial check verifies that
  // no diagnostic level/verb surfaces in the rendered body even when the DOM is fully mounted.
  const content = {
    title: 'Working with Numbers',
    instructions: 'Try your best on each part.',
    reading_passage: 'Numbers are useful.',
    tasks: [
      { step: 1, description: 'Add these fractions.', skill_name: 'Fractions' },
      { step: 2, description: 'Round these decimals.', skill_name: 'Decimals' },
    ],
  };

  it('renders the skill-name heading for the current task and leaks no level/verb', () => {
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    // Advance from read → tasks phase (mirrors AssignmentPlayer.test.tsx harness)
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));

    // The first task's skill_name must be rendered as the section heading
    expect(screen.getByTestId('task-skill-heading')).toHaveTextContent('Fractions');

    // The whole rendered DOM must not surface any diagnostic level/verb/band term
    const body = document.body.textContent ?? '';
    expect(hasDiagnosticVocab(body)).toBe(false); // no scaffolded/extension/Reinforce/Enrich/band/grade level
  });

  it('renders NO heading when the assignment has a single distinct skill', () => {
    const singleSkillContent = {
      ...content,
      tasks: [
        { step: 1, description: 'Add these fractions.', skill_name: 'Fractions' },
        { step: 2, description: 'More fractions.', skill_name: 'Fractions' },
      ],
    };
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={singleSkillContent}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    // Advance from read → tasks phase
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));

    // Single distinct skill → no heading rendered
    expect(screen.queryByTestId('task-skill-heading')).not.toBeInTheDocument();
  });
});
