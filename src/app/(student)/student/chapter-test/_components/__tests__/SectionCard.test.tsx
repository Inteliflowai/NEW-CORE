// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionCard } from '../SectionCard';
import type { SectionData } from '../SectionCard';

const SECTION: SectionData = {
  id: 'sec1',
  section_order: 1,
  section_kind: 'comprehension',
  title: 'Reading Comprehension',
  time_minutes: 10,
  total_points: 15,
  power_skill: 'Critical Thinking',
};

describe('SectionCard', () => {
  it('renders the section title', () => {
    render(
      <SectionCard section={SECTION} isActive={false}>
        <p>child</p>
      </SectionCard>,
    );
    expect(screen.getByText('Reading Comprehension')).toBeTruthy();
  });

  it('renders time and points', () => {
    render(
      <SectionCard section={SECTION} isActive={false}>
        <p>child</p>
      </SectionCard>,
    );
    expect(screen.getByText(/10 min/)).toBeTruthy();
    expect(screen.getByText(/15 pts/)).toBeTruthy();
  });

  it('applies bg-brand-surface class when isActive=true', () => {
    const { container } = render(
      <SectionCard section={SECTION} isActive={true}>
        <p>child</p>
      </SectionCard>,
    );
    expect(container.innerHTML).toContain('bg-brand-surface');
  });

  it('applies bg-surface (not bg-brand-surface) when isActive=false', () => {
    const { container } = render(
      <SectionCard section={SECTION} isActive={false}>
        <p>child</p>
      </SectionCard>,
    );
    expect(container.innerHTML).toContain('bg-surface');
    expect(container.innerHTML).not.toContain('bg-brand-surface');
  });

  it('renders children', () => {
    render(
      <SectionCard section={SECTION} isActive={false}>
        <p>test child content</p>
      </SectionCard>,
    );
    expect(screen.getByText('test child content')).toBeTruthy();
  });

  it('renders power_skill when provided', () => {
    render(
      <SectionCard section={SECTION} isActive={false}>
        <p>child</p>
      </SectionCard>,
    );
    expect(screen.getByText('Critical Thinking')).toBeTruthy();
  });

  it('does not render power_skill text when null', () => {
    render(
      <SectionCard section={{ ...SECTION, power_skill: null }} isActive={false}>
        <p>child</p>
      </SectionCard>,
    );
    expect(screen.queryByText('Critical Thinking')).toBeNull();
  });
});
