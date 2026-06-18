// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { GrowthMotif } from '../GrowthMotif';

describe('GrowthMotif', () => {
  it('renders one bar per history point when history has 4 or more values', () => {
    render(<GrowthMotif history={[40, 60, 55, 80]} />);
    const bars = screen.getAllByRole('presentation');
    expect(bars).toHaveLength(4);
  });

  it('renders bars for exactly 4 points', () => {
    render(<GrowthMotif history={[10, 20, 30, 40]} />);
    expect(screen.getAllByRole('presentation')).toHaveLength(4);
  });

  it('renders bars for more than 4 points', () => {
    render(<GrowthMotif history={[10, 20, 30, 40, 50, 60, 70, 80]} />);
    expect(screen.getAllByRole('presentation')).toHaveLength(8);
  });

  it('renders cold-start text when history has fewer than 4 points', () => {
    render(<GrowthMotif history={[55, 70]} />);
    expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
  });

  it('renders cold-start text when history is empty', () => {
    render(<GrowthMotif history={[]} />);
    expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
  });

  it('renders cold-start text when history has exactly 3 points', () => {
    render(<GrowthMotif history={[30, 50, 70]} />);
    expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
  });

  it('does NOT render bars in cold-start state', () => {
    render(<GrowthMotif history={[55]} />);
    expect(screen.queryAllByRole('presentation')).toHaveLength(0);
  });

  it('shows deltaLabel when provided alongside enough history', () => {
    render(<GrowthMotif history={[40, 60, 55, 80]} deltaLabel="+18 pts vs 4 weeks ago" />);
    expect(screen.getByText('+18 pts vs 4 weeks ago')).toBeInTheDocument();
  });

  it('does NOT show deltaLabel in cold-start state even if provided', () => {
    render(<GrowthMotif history={[40]} deltaLabel="+18 pts vs 4 weeks ago" />);
    expect(screen.queryByText('+18 pts vs 4 weeks ago')).not.toBeInTheDocument();
  });

  it('copy never contains peer-relative language', () => {
    const { container } = render(<GrowthMotif history={[40, 60, 55, 80]} deltaLabel="you vs 4 weeks ago" />);
    expect(container.textContent).not.toMatch(/class average|other students|compared to peers/i);
  });

  it('loud context (data-intensity=loud) renders the component inside an appropriately marked wrapper', () => {
    const { container } = render(
      <div data-intensity="loud">
        <GrowthMotif history={[40, 60, 55, 80]} deltaLabel="+18 pts vs 4 weeks ago" />
      </div>
    );
    // The motif renders bars inside a loud wrapper — the wrapper carries data-intensity, not the component itself
    expect(container.querySelector('[data-intensity="loud"]')).toBeTruthy();
    // Bars are still present regardless of intensity context
    expect(screen.getAllByRole('presentation')).toHaveLength(4);
  });

  it('calm context (data-intensity=calm) renders the component without altering bar count', () => {
    const { container } = render(
      <div data-intensity="calm">
        <GrowthMotif history={[40, 60, 55, 80]} deltaLabel="+18 pts vs 4 weeks ago" />
      </div>
    );
    expect(container.querySelector('[data-intensity="calm"]')).toBeTruthy();
    expect(screen.getAllByRole('presentation')).toHaveLength(4);
  });

  it('component root carries data-growth-motif attribute distinguishing it', () => {
    const { container } = render(<GrowthMotif history={[40, 60, 55, 80]} />);
    // The motif root element should carry a data-testid or class that identifies it
    expect(container.querySelector('[data-testid="growth-motif"]')).toBeTruthy();
  });
});
