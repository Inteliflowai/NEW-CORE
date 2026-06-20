// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConceptGapsRail } from '../ConceptGapsRail';
import { pctIncorrectToWords } from '@/lib/copy/pctIncorrectToWords';

describe('ConceptGapsRail', () => {
  it('(a) empty state: renders "No class-wide gaps" when gaps array is empty', () => {
    const { container } = render(<ConceptGapsRail gaps={[]} />);
    expect(container.innerHTML).toContain('No class-wide gaps');
  });

  it('(b) non-empty: renders skill_name, not question_text or raw pct_incorrect', () => {
    const gaps = [
      {
        question_index: 0,
        question_text: 'skill:secret',
        skill_name: 'Adding fractions',
        pct_incorrect: 80,
      },
    ];
    const { container } = render(<ConceptGapsRail gaps={gaps} />);

    // skill_name must appear
    expect(container.innerHTML).toContain('Adding fractions');

    // pctIncorrectToWords(80) must appear
    expect(container.innerHTML).toContain(pctIncorrectToWords(80)); // "nearly all"

    // question_text (opaque id) must NEVER appear
    expect(container.innerHTML).not.toContain('skill:secret');

    // raw pct_incorrect number must NEVER appear
    expect(container.innerHTML).not.toContain('80');
  });
});
