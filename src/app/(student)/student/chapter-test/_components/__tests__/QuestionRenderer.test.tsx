// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionRenderer } from '../QuestionRenderer';
import type { QuestionData, ResponseDraft } from '../QuestionRenderer';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MCQ_QUESTION: QuestionData = {
  id: 'q1',
  question_order: 1,
  question_type: 'mcq',
  question_text: 'What is the main theme of the story?',
  payload: {
    choices: [
      { label: 'A', text: 'Courage' },
      { label: 'B', text: 'Friendship' },
      { label: 'C', text: 'Betrayal' },
      { label: 'D', text: 'Love' },
    ],
  },
  points: 2,
};

const SHORT_ANSWER_QUESTION: QuestionData = {
  id: 'q2',
  question_order: 2,
  question_type: 'short_answer',
  question_text: 'Describe the setting in your own words.',
  payload: {},
  points: 3,
};

const DATA_Q: QuestionData = {
  id: 'q3',
  question_order: 3,
  question_type: 'data_interpretation',
  question_text: 'What trend does this data show?',
  payload: { mermaid: 'graph TD; A-->B; B-->C;' },
  points: 4,
};

const DATA_Q_NO_MERMAID: QuestionData = {
  ...DATA_Q,
  id: 'q4',
  payload: {},
};

const MATCHING_QUESTION: QuestionData = {
  id: 'q5',
  question_order: 5,
  question_type: 'matching',
  question_text: 'Match each term to its definition.',
  payload: {
    left_items: ['Protagonist', 'Antagonist'],
    right_items: ['Main character', 'Opposing force'],
  },
  points: 4,
};

const EMPTY: ResponseDraft = {};

// ── MCQ ────────────────────────────────────────────────────────────────────────

describe('QuestionRenderer — MCQ', () => {
  it('renders one radio button for each choice', () => {
    render(<QuestionRenderer question={MCQ_QUESTION} response={EMPTY} onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('renders the question text', () => {
    render(<QuestionRenderer question={MCQ_QUESTION} response={EMPTY} onChange={vi.fn()} />);
    expect(screen.getByText(/main theme/i)).toBeTruthy();
  });

  it('calls onChange with { response_payload: { selected_label } } when a choice is selected', () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={MCQ_QUESTION} response={EMPTY} onChange={onChange} />);
    fireEvent.click(screen.getByDisplayValue('B'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        response_payload: expect.objectContaining({ selected_label: 'B' }),
      }),
    );
  });

  it('marks the currently selected choice as checked', () => {
    render(
      <QuestionRenderer
        question={MCQ_QUESTION}
        response={{ response_payload: { selected_label: 'C' } }}
        onChange={vi.fn()}
      />,
    );
    const radioC = screen.getByDisplayValue('C') as HTMLInputElement;
    expect(radioC.checked).toBe(true);
  });
});

// ── short_answer ───────────────────────────────────────────────────────────────

describe('QuestionRenderer — short_answer', () => {
  it('renders a textarea with aria-label="Answer"', () => {
    render(<QuestionRenderer question={SHORT_ANSWER_QUESTION} response={EMPTY} onChange={vi.fn()} />);
    const ta = screen.getByRole('textbox', { name: /answer/i });
    expect(ta.tagName).toBe('TEXTAREA');
  });

  it('calls onChange with response_text on textarea input', () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={SHORT_ANSWER_QUESTION} response={EMPTY} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: /answer/i }), {
      target: { value: 'The setting is a small coastal town.' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ response_text: 'The setting is a small coastal town.' }),
    );
  });
});

// ── data_interpretation ────────────────────────────────────────────────────────

describe('QuestionRenderer — data_interpretation', () => {
  it('renders a <pre> block when payload.mermaid is present', () => {
    const { container } = render(
      <QuestionRenderer question={DATA_Q} response={EMPTY} onChange={vi.fn()} />,
    );
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('graph TD');
  });

  it('renders a textarea for the answer', () => {
    render(<QuestionRenderer question={DATA_Q} response={EMPTY} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /answer/i })).toBeTruthy();
  });

  it('does NOT render a <pre> when mermaid is absent', () => {
    const { container } = render(
      <QuestionRenderer question={DATA_Q_NO_MERMAID} response={EMPTY} onChange={vi.fn()} />,
    );
    expect(container.querySelector('pre')).toBeNull();
  });

  it('calls onChange with response_text on textarea input', () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={DATA_Q} response={EMPTY} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: /answer/i }), {
      target: { value: 'The trend is upward.' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ response_text: 'The trend is upward.' }),
    );
  });
});

// ── matching ───────────────────────────────────────────────────────────────────

describe('QuestionRenderer — matching', () => {
  it('renders a combobox for each left item', () => {
    render(<QuestionRenderer question={MATCHING_QUESTION} response={EMPTY} onChange={vi.fn()} />);
    const combos = screen.getAllByRole('combobox');
    expect(combos).toHaveLength(2);
  });

  it('calls onChange with pairs in response_payload when a right item is selected', () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={MATCHING_QUESTION} response={EMPTY} onChange={onChange} />);
    // Select right_idx=0 for the first left item (left_idx=0)
    const combos = screen.getAllByRole('combobox');
    fireEvent.change(combos[0], { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        response_payload: expect.objectContaining({
          pairs: expect.arrayContaining([{ left_idx: 0, right_idx: 0 }]),
        }),
      }),
    );
  });
});

// ── fallback (unknown type) ────────────────────────────────────────────────────

describe('QuestionRenderer — unknown type (fallback)', () => {
  it('renders a textarea fallback', () => {
    const unknownQ: QuestionData = {
      ...SHORT_ANSWER_QUESTION,
      id: 'q99',
      question_type: 'mystery_type',
    };
    render(<QuestionRenderer question={unknownQ} response={EMPTY} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /answer/i }).tagName).toBe('TEXTAREA');
  });
});
