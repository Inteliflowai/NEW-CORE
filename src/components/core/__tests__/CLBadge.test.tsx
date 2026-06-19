// @vitest-environment jsdom
// src/components/core/__tests__/CLBadge.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CLBadge, type ConfidenceWord } from '../CLBadge';
import type { SkillLearningState } from '@/lib/skills/clVerbs';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// State → CL verb mapping
// ---------------------------------------------------------------------------
describe('CLBadge — state → verb', () => {
  const cases: [SkillLearningState, string][] = [
    ['needs_different_instruction', 'Reinforce'],
    ['needs_more_time',             'Reinforce'],
    ['on_track',                    'On Track'],
    ['ready_to_extend',             'Enrich'],
  ];

  for (const [state, expectedVerb] of cases) {
    it(`${state} → "${expectedVerb}"`, () => {
      render(<CLBadge state={state} />);
      expect(screen.getByText(expectedVerb)).toBeInTheDocument();
    });
  }
});

// ---------------------------------------------------------------------------
// Null-verb states → "Not yet assessed"
// ---------------------------------------------------------------------------
describe('CLBadge — cold-start states → "Not yet assessed"', () => {
  it('insufficient_data → "Not yet assessed"', () => {
    render(<CLBadge state="insufficient_data" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });

  it('not_attempted → "Not yet assessed"', () => {
    render(<CLBadge state="not_attempted" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Confidence → soft word (never the raw number)
// ---------------------------------------------------------------------------
describe('CLBadge — confidence → soft word', () => {
  it('confidence 70 → "consistent"', () => {
    render(<CLBadge state="on_track" confidence={70} />);
    expect(screen.getByText(/consistent/i)).toBeInTheDocument();
  });

  it('confidence 95 → "consistent"', () => {
    render(<CLBadge state="on_track" confidence={95} />);
    expect(screen.getByText(/consistent/i)).toBeInTheDocument();
  });

  it('confidence 40 → "tentative"', () => {
    render(<CLBadge state="on_track" confidence={40} />);
    expect(screen.getByText(/tentative/i)).toBeInTheDocument();
  });

  it('confidence 69 → "tentative"', () => {
    render(<CLBadge state="on_track" confidence={69} />);
    expect(screen.getByText(/tentative/i)).toBeInTheDocument();
  });

  it('confidence 0 → "emerging"', () => {
    render(<CLBadge state="on_track" confidence={0} />);
    expect(screen.getByText(/emerging/i)).toBeInTheDocument();
  });

  it('confidence 39 → "emerging"', () => {
    render(<CLBadge state="on_track" confidence={39} />);
    expect(screen.getByText(/emerging/i)).toBeInTheDocument();
  });

  it('confidence null → no confidence text shown', () => {
    render(<CLBadge state="on_track" confidence={null} />);
    expect(screen.queryByText(/consistent|tentative|emerging/i)).not.toBeInTheDocument();
  });

  it('confidence undefined (omitted) → no confidence text shown', () => {
    render(<CLBadge state="on_track" />);
    expect(screen.queryByText(/consistent|tentative|emerging/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CRITICAL: raw 0–100 number NEVER appears in DOM
// ---------------------------------------------------------------------------
describe('CLBadge — raw confidence number NEVER appears in DOM', () => {
  const scoreValues = [0, 39, 40, 69, 70, 95, 100];

  for (const score of scoreValues) {
    it(`score ${score} is not rendered as text`, () => {
      render(<CLBadge state="on_track" confidence={score} />);
      // Check exact string and as part of a longer string
      expect(screen.queryByText(String(score))).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(`\\b${score}\\b`))).not.toBeInTheDocument();
    });
  }

  it('no numeric text appears when confidence is 55', () => {
    const { container } = render(<CLBadge state="needs_more_time" confidence={55} />);
    // No element should contain only digits
    const allText = container.textContent ?? '';
    expect(/\b\d{2,3}\b/.test(allText)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// confidenceWord prop — bypasses numeric path
// ---------------------------------------------------------------------------
describe('CLBadge — confidenceWord prop', () => {
  it('renders the soft word when confidenceWord given, no number', () => {
    render(<CLBadge state="on_track" confidenceWord="consistent" />);
    expect(screen.getByText(/consistent/)).toBeInTheDocument();
  });

  it('confidenceWord null suppresses confidence display', () => {
    render(<CLBadge state="on_track" confidenceWord={null} />);
    expect(screen.queryByText(/consistent|tentative|emerging/i)).not.toBeInTheDocument();
  });

  it('confidenceWord overrides numeric confidence when both provided', () => {
    render(<CLBadge state="on_track" confidence={10} confidenceWord="consistent" />);
    expect(screen.getByText(/consistent/)).toBeInTheDocument();
    expect(screen.queryByText(/emerging/i)).not.toBeInTheDocument();
  });

  it('ConfidenceWord type is exported and assignable', () => {
    const word: ConfidenceWord = 'tentative';
    render(<CLBadge state="on_track" confidenceWord={word} />);
    expect(screen.getByText(/tentative/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Semantic / a11y
// ---------------------------------------------------------------------------
describe('CLBadge — accessibility', () => {
  it('has role="status" for screen readers', () => {
    render(<CLBadge state="on_track" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('"Not yet assessed" state also has role="status"', () => {
    render(<CLBadge state="not_attempted" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
