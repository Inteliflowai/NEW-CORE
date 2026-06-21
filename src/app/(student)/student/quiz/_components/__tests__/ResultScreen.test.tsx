// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultScreen } from '../ResultScreen';
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';

// Pre-built bundle fixtures (as the server would produce them — leak-free).
const STRONG_MSG: StudentResultBundle['scoreMessage'] = {
  message: 'Solid work, Alex. A couple of spots to revisit.',
  teliMsg: 'Solid work, Alex. Let us look at a couple of spots in your assignments.',
  teliState: 'idle',
};
const TOUGH_MSG: StudentResultBundle['scoreMessage'] = {
  message: 'Sam, this one was tough. Assignments start over.',
  teliMsg: 'Sam, tough one. Your assignments will go back to the basics, slower.',
  teliState: 'speaking',
};

describe('ResultScreen — done', () => {
  it('renders the done heading', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    // The heading is qualitative — not "85%" or "Grade Level"
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toContain('quiz');
  });

  it('renders the pre-built coaching message and the soft mastery label', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    // message = plain coaching headline (unique: "A couple of spots to revisit")
    expect(screen.getByText(/A couple of spots to revisit/)).toBeTruthy();
    // teliMsg = Teli card copy (unique: "Let us look at a couple of spots in your assignments")
    expect(screen.getByText(/Let us look at a couple of spots in your assignments/)).toBeTruthy();
    expect(screen.getByText('On Track')).toBeTruthy();
  });

  it('LEAK AUDIT: no digits or % render in the done screen (component holds no score)', () => {
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain('%');
  });

  it('LEAK AUDIT: tough-band done screen renders no digits or %', () => {
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={TOUGH_MSG}
        masteryLabel="Building"
        needsStudyGuide
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain('%');
  });

  it('renders a per-question review when reviewItems are provided', () => {
    const items = [
      {
        position: 1,
        question_type: 'mcq' as const,
        question_text: 'What is two plus two?',
        student_answer: 'A',
        is_correct: false,
        correct_answer: 'B',
      },
    ];
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="On Track"
        needsStudyGuide={false}
        reviewItems={items}
        onBack={vi.fn()}
      />,
    );
    // Review section should render without exposing numeric score
    expect(screen.getByText(/how did you do/i)).toBeTruthy();
  });

  it('shows study guide accordion when needsStudyGuide and studyGuide is provided', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={TOUGH_MSG}
        masteryLabel="Building"
        needsStudyGuide
        reviewItems={[]}
        studyGuide="Review: fractions mean parts of a whole."
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/revision notes/i)).toBeTruthy();
  });

  it('shows strong-performance copy (not study guide) when needsStudyGuide is false', () => {
    render(
      <ResultScreen
        variant="done"
        scoreMessage={STRONG_MSG}
        masteryLabel="Strong"
        needsStudyGuide={false}
        reviewItems={[]}
        studyGuide={null}
        onBack={vi.fn()}
      />,
    );
    // Should not show the study guide accordion label
    expect(screen.queryByText(/revision notes/i)).toBeNull();
  });

  it('XSS: study guide with injected tags renders escaped — no live script/img in DOM', () => {
    const maliciousGuide =
      '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n**Bold term** is safe.';
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={TOUGH_MSG}
        masteryLabel="Building"
        needsStudyGuide
        reviewItems={[]}
        studyGuide={maliciousGuide}
        onBack={vi.fn()}
      />,
    );

    // Open the study guide accordion
    const accordionBtn = screen.getByRole('button', { name: /revision notes/i });
    fireEvent.click(accordionBtn);

    // No live <script> or <img> elements injected into the DOM
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();

    // The angle brackets must be escaped (not rendered as live tags).
    // The innerHTML of the accordion content area should contain &lt; not raw <script>
    const accordionContent = container.querySelector('.px-4.pb-4');
    expect(accordionContent?.innerHTML).toContain('&lt;script&gt;');
    expect(accordionContent?.innerHTML).toContain('&lt;img');

    // **bold** should still produce a <strong> tag
    expect(container.querySelector('strong')?.textContent).toBe('Bold term');
  });
});

describe('ResultScreen — forfeit', () => {
  it('renders forfeit closure copy without a score', () => {
    const { container } = render(
      <ResultScreen
        variant="forfeit"
        forfeitReason="closure"
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Quiz Closed');
    expect(container.textContent).not.toMatch(/\d+%/);
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);  // no raw 2–3 digit numbers
  });

  it('renders forfeit time_up copy', () => {
    const { container } = render(
      <ResultScreen
        variant="forfeit"
        forfeitReason="time_up"
        onBack={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Time ran out');
  });
});

describe('ResultScreen — grading-pending', () => {
  it('renders the grading-pending screen', () => {
    render(<ResultScreen variant="grading-pending" onBack={vi.fn()} />);
    expect(screen.getByText(/being graded/i)).toBeTruthy();
  });
});
