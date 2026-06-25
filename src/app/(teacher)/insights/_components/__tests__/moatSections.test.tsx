// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComprehensionBySkill } from '@/app/(teacher)/insights/_components/ComprehensionBySkill';
import { ClassComprehensionTrend } from '@/app/(teacher)/insights/_components/ClassComprehensionTrend';
import { HowClassLearns } from '@/app/(teacher)/insights/_components/HowClassLearns';

const skill = {
  skill_id: 'sk1', skill_name: 'Equivalent fractions',
  reinforce: 2, on_track: 1, enrich: 0,
  reinforce_students: [{ student_id: 's1', full_name: 'Ava Ng' }],
  on_track_students: [{ student_id: 's2', full_name: 'Ben Ortiz' }],
  enrich_students: [],
};

describe('ComprehensionBySkill', () => {
  it('renders the tally in the 3 verbs and links names to the Skill Map', () => {
    render(<ComprehensionBySkill skills={[skill]} classId="c1" />);
    expect(screen.getByText('Equivalent fractions')).toBeInTheDocument();
    expect(screen.getByText(/2 Reinforce · 1 On Track · 0 Enrich/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Ava Ng' });
    expect(link).toHaveAttribute('href', '/students/s1?class=c1');
  });
  it('is quiet (renders nothing) when there are no skills', () => {
    const { container } = render(<ComprehensionBySkill skills={[]} classId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ClassComprehensionTrend', () => {
  it('shows a soft direction line + sparkline, and surfaces NO raw percentage', () => {
    render(<ClassComprehensionTrend trend={{ points: [
      { date: '2026-05-04', index: 40 }, { date: '2026-05-11', index: 70 }, { date: '2026-05-18', index: 85 },
    ], direction: 'climbing' }} />);
    expect(screen.getByText(/has been climbing/i)).toBeInTheDocument();
    expect(screen.getByTestId('grade-trend-sparkline')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull(); // no raw % printed
  });
  it('is quiet until there is a real direction (no silent 2-dot graph)', () => {
    const { container } = render(<ClassComprehensionTrend trend={{ points: [
      { date: '2026-05-04', index: 40 }, { date: '2026-05-11', index: 80 },
    ], direction: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HowClassLearns', () => {
  it('renders the reassurance line', () => {
    render(<HowClassLearns learningStyle={{ styles: ['visual', 'hands-on'], line: 'Your class spans visual and hands-on learners — assignments differentiate to each.' }} />);
    expect(screen.getByText(/differentiate to each/)).toBeInTheDocument();
  });
  it('is quiet when there is no line', () => {
    const { container } = render(<HowClassLearns learningStyle={{ styles: [], line: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
