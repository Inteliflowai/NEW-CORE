// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighFiveNote } from '../HighFiveNote';

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

describe('HighFiveNote', () => {
  it('renders the note text', () => {
    render(<HighFiveNote text="You kept going when it was hard — that's real grit." />);
    expect(screen.getByText(/kept going when it was hard/i)).toBeInTheDocument();
  });
});
