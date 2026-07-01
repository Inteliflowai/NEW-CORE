// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasParentLeak } from '@/lib/copy/parentGuard';

import { ContactTeacherCard } from '../ContactTeacherCard';
import { HelpAtHomeCard } from '../HelpAtHomeCard';
import { CelebrateCard } from '../CelebrateCard';

describe('ContactTeacherCard', () => {
  it('renders a mailto link per teacher', () => {
    const { container } = render(
      <ContactTeacherCard
        teachers={[
          { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature' },
          { teacherId: 't2', name: 'Mr. Bell', email: 'b@x.edu', classLabel: 'Math' },
        ]}
      />,
    );
    const links = Array.from(container.querySelectorAll('a[href^="mailto:"]'));
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('mailto:w@x.edu');
    expect(container.textContent).toContain('Ms. Whitfield');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
  it('renders nothing when there are no teachers', () => {
    const { container } = render(<ContactTeacherCard teachers={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('HelpAtHomeCard', () => {
  it('shows up to 3 clean starters and drops leaky ones', () => {
    const { container } = render(
      <HelpAtHomeCard
        starters={[
          'What surprised you today?',
          'What was their class average this week?', // leaky → dropped
          'What is something you want to try tomorrow?',
          'What made you laugh today?',
          'One more idea here.',
        ]}
      />,
    );
    expect(container.textContent).toContain('What surprised you today?');
    expect(container.textContent).not.toContain('class average');
    // max 3 rendered starters
    const items = container.querySelectorAll('[data-testid="starter-row"]');
    expect(items.length).toBeLessThanOrEqual(3);
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
  it('renders nothing when no safe starters remain', () => {
    const { container } = render(<HelpAtHomeCard starters={['What was their class average?']} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders a copy button for each shown starter', () => {
    render(<HelpAtHomeCard starters={['What surprised you today?']} />);
    expect(screen.getAllByRole('button', { name: /copy/i }).length).toBeGreaterThan(0);
  });
});

describe('CelebrateCard', () => {
  it('renders the note when present', () => {
    const { container } = render(<CelebrateCard note="Great listening today!" />);
    expect(container.textContent).toContain('Great listening today!');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
  it('renders nothing when note is null', () => {
    const { container } = render(<CelebrateCard note={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders nothing when the note would leak (defense-in-depth)', () => {
    const { container } = render(<CelebrateCard note="Alex is on track this week." />);
    expect(container.firstChild).toBeNull();
  });
});
