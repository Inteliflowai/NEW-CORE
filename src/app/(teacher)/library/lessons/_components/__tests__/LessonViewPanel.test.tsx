// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { LessonViewPanel } from '../LessonViewPanel';
import type { LessonLibRow } from '@/lib/lessons/loadLessonLibrary';

const lesson: LessonLibRow = {
  id: 'L1',
  title: 'Photosynthesis: How Plants Make Food',
  subject: 'Science',
  grade_level: '7',
  status: 'published',
  quiz_count: 1,
  created_at: '2026-06-23T08:00:00Z',
  parsed_content: {
    title: 'Photosynthesis: How Plants Make Food',
    objectives: ['Explain how plants convert light to energy'],
    key_concepts: ['chlorophyll', 'glucose'],
    vocabulary: [{ term: 'stomata', definition: 'tiny pores in a leaf' }],
    misconception_risks: ['Plants get their food from the soil'],
    summary: 'Plants turn light energy into stored chemical energy.',
  },
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('LessonViewPanel', () => {
  it('renders the parsed lesson plan: objectives, key concepts, vocabulary, misconceptions, summary', () => {
    render(<LessonViewPanel lesson={lesson} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Explain how plants convert light to energy')).toBeInTheDocument();
    expect(screen.getByText(/chlorophyll/)).toBeInTheDocument();
    expect(screen.getByText('stomata')).toBeInTheDocument();
    expect(screen.getByText('tiny pores in a leaf')).toBeInTheDocument();
    expect(screen.getByText('Plants get their food from the soil')).toBeInTheDocument();
    expect(screen.getByText('Plants turn light energy into stored chemical energy.')).toBeInTheDocument();
  });

  it('shows a dignified note when the lesson has no parsed plan yet', () => {
    render(<LessonViewPanel lesson={{ ...lesson, parsed_content: null }} onClose={vi.fn()} />);
    expect(screen.getByText(/hasn.t been processed yet|not been processed|no lesson plan/i)).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<LessonViewPanel lesson={lesson} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('carries no banned coach-posture words', () => {
    const { container } = render(<LessonViewPanel lesson={lesson} onClose={vi.fn()} />);
    expect(hasBannedWord(container.textContent ?? '')).toBe(false);
  });
});
