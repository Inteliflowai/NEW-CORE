// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignatureMoment } from '../SignatureMoment';

// Force prefers-reduced-motion so framer-motion's AnimatePresence resolves exits
// instantly in jsdom (real motion is verified live via Playwright). This also
// exercises the reduced-motion path (every beat snaps to its end state).
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

describe('SignatureMoment prototype', () => {
  it('defaults to the teacher register and switches registers via the toggle', async () => {
    render(<SignatureMoment />);
    expect(screen.getByRole('tab', { name: 'Teacher' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Leila's cohesion dipped/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Student' }));
    expect(screen.getByRole('tab', { name: 'Student' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/your writing's getting sharper/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Parent' }));
    expect(await screen.findByText(/Maya's reading is really coming along/i)).toBeInTheDocument();
  });

  it('offers an invitation AND a quiet decline (suggests, never auto-acts) + replay', () => {
    render(<SignatureMoment />);
    expect(screen.getByRole('button', { name: 'Open the reteach' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replay/i })).toBeInTheDocument();
  });
});
