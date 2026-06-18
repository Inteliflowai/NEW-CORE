// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import '@/test/setup-dom';
import { MathText } from '../MathText';

afterEach(() => {
  cleanup();
});

describe('MathText', () => {
  it('renders surrounding plain text', () => {
    render(<MathText>Hello world</MathText>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders an inline $x^2$ segment as KaTeX markup (contains .katex)', () => {
    const { container } = render(<MathText>{'Solve $x^2$'}</MathText>);
    // KaTeX sets class="katex" on its output span
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders block $$x^2$$ as KaTeX markup', () => {
    const { container } = render(<MathText>{'$$x^2$$'}</MathText>);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('degrades to raw text on a malformed inline segment, never throws', () => {
    // \frac{ without closing brace is a KaTeX parse error
    expect(() => render(<MathText>{'$\\frac{$'}</MathText>)).not.toThrow();
  });

  it('shows raw segment text (not blank) when KaTeX parse fails', () => {
    const { container } = render(<MathText>{'prefix $\\frac{$ suffix'}</MathText>);
    // The raw fallback text must appear somewhere in the output
    expect(container.textContent).toContain('\\frac{');
    // The surrounding text must also appear
    expect(container.textContent).toContain('prefix');
    expect(container.textContent).toContain('suffix');
  });

  it('renders a mix of plain text, inline math, and block math', () => {
    const { container } = render(
      <MathText>{'Area is $A = \\pi r^2$ and $$V = \\frac{4}{3}\\pi r^3$$ done'}</MathText>
    );
    // At least one .katex element from the valid segments
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain('done');
  });
});
