// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassSwitcherPill } from '../ClassSwitcherPill';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/roster',
}));

const MOCK_CLASSES = [
  { class_id: 'c1', label: 'Algebra I — Period 3' },
  { class_id: 'c2', label: 'Geometry' },
];

beforeEach(() => {
  replace.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ classes: MOCK_CLASSES }),
    }),
  );
});

describe('ClassSwitcherPill', () => {
  it('defaults ?class= to the first class on mount when none is selected', async () => {
    render(<ClassSwitcherPill />);
    await screen.findByText('Algebra I — Period 3');
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('class=c1'));
  });

  it('renders fetched classes and writes ?class= on selection', async () => {
    render(<ClassSwitcherPill />);
    expect(await screen.findByText('Algebra I — Period 3')).toBeInTheDocument();
    expect(screen.getByText('Geometry')).toBeInTheDocument();

    replace.mockClear(); // ignore the mount-time default
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c2' } });

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('class=c2'));
  });

  it('renders no aria-current (it is not nav)', async () => {
    render(<ClassSwitcherPill />);
    // Wait for loading to resolve
    await screen.findByText('Algebra I — Period 3');
    const combo = screen.getByRole('combobox');
    expect(combo.getAttribute('aria-current')).toBeNull();
  });
});
