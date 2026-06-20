// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IconToday, IconRoster, IconSignOut } from '../icons';

describe('icons', () => {
  it('renders an aria-hidden svg that inherits color and accepts className', () => {
    const { container } = render(<IconToday className="size-4" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('class')).toContain('size-4');
  });

  it('exports distinct icon components', () => {
    expect(IconRoster).not.toBe(IconSignOut);
  });
});
