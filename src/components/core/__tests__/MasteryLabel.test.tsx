// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { MasteryLabel } from '../MasteryLabel';

describe('MasteryLabel', () => {
  it("renders 'Building' for band 'reteach'", () => {
    render(<MasteryLabel band="reteach" />);
    expect(screen.getByText('Building')).toBeInTheDocument();
  });

  it("renders 'On Track' for band 'grade_level'", () => {
    render(<MasteryLabel band="grade_level" />);
    expect(screen.getByText('On Track')).toBeInTheDocument();
  });

  it("renders 'Strong' for band 'advanced'", () => {
    render(<MasteryLabel band="advanced" />);
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it("renders 'Not yet assessed' for null band", () => {
    render(<MasteryLabel band={null} />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });

  it("renders 'Not yet assessed' for unknown band string", () => {
    render(<MasteryLabel band="some_unknown_band" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });

  it('NEVER renders the raw enum value for reteach', () => {
    render(<MasteryLabel band="reteach" />);
    expect(screen.queryByText('reteach')).not.toBeInTheDocument();
  });

  it('NEVER renders the raw enum value for grade_level', () => {
    render(<MasteryLabel band="grade_level" />);
    expect(screen.queryByText('grade_level')).not.toBeInTheDocument();
  });

  it('NEVER renders the raw enum value for advanced', () => {
    render(<MasteryLabel band="advanced" />);
    expect(screen.queryByText('advanced')).not.toBeInTheDocument();
  });

  it('renders as a pill element (has mastery-label class)', () => {
    const { container } = render(<MasteryLabel band="reteach" />);
    expect(container.firstChild).toHaveClass('mastery-label');
  });
});
