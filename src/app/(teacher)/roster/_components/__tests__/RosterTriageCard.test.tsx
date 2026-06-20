// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RosterTriageCard } from '../RosterTriageCard';
import type { FocusGroupItem, RosterItem } from '@/lib/signals/loadRosterSignals';
import { actionChipLabel } from '@/lib/copy/actionChipLabel';

const STUDENT_ID = 'stu-001';
const CLASS_ID = 'cls-abc';

const mockItem: FocusGroupItem = {
  student_id: STUDENT_ID,
  full_name: 'Alex Turner',
  diagnosis: {
    suggestedAction: 'reteach',
    severity: 3,
    diagnosis: 'Quiz average is 42% — needs another pass.',
  },
};

const mockRosterEntry: RosterItem = {
  student_id: STUDENT_ID,
  full_name: 'Alex Turner',
  band: 'reteach',
  volatile: true,
  risk: {
    risk_score: 73,
    risk_level: 'high',
    risk_factors: ['Low homework average'],
  },
};

const rosterById: Record<string, RosterItem> = {
  [STUDENT_ID]: mockRosterEntry,
};

describe('RosterTriageCard', () => {
  it('renders the diagnosis sentence text', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('Quiz average is 42% — needs another pass.');
  });

  it('renders the action chip label for suggestedAction', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    const chipLabel = actionChipLabel('reteach').label; // "reteach now"
    expect(container.innerHTML).toContain(chipLabel);
  });

  it('renders MasteryLabel "Building" for band reteach', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('Building');
  });

  it('renders volatile indicator when r.volatile is true', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('moving around lately');
  });

  it('renders the first risk factor', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('Low homework average');
  });

  it('renders look-closer link with correct href', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(`/students/${STUDENT_ID}?from=roster&class=${CLASS_ID}`);
  });

  it('NEVER leaks risk_score number (73)', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).not.toContain('73');
  });

  it('renders severity 3 dot-count with correct aria-label', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('severity 3 of 3');
  });

  it('renders the student name', () => {
    const { container } = render(
      <RosterTriageCard item={mockItem} rosterById={rosterById} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('Alex Turner');
  });
});
