// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ClassPulseStrip } from '../ClassPulseStrip';

const counts = { reteach: 2, grade_level: 4, advanced: 1, not_assessed: 1 };

describe('ClassPulseStrip', () => {
  it('renders each word label', () => {
    const { container } = render(<ClassPulseStrip counts={counts} />);
    expect(container.innerHTML).toContain('Building');
    expect(container.innerHTML).toContain('On Track');
    expect(container.innerHTML).toContain('Strong');
    expect(container.innerHTML).toContain('Not yet assessed');
  });

  it('renders each count in the legend', () => {
    const { container } = render(<ClassPulseStrip counts={counts} />);
    // counts are 2, 4, 1, 1 — check that each appears
    const text = container.innerHTML;
    expect(text).toContain('2');
    expect(text).toContain('4');
    // "1" appears twice (advanced and not_assessed) — just check it exists
    expect(text).toContain('1');
  });
});
