// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertsList } from '../AlertsList';
import type { AlertRowItem } from '../AlertRow';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));

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

const rows: AlertRowItem[] = [
  { id: '1', student_id: 's1', student_name: 'Ada Lovelace', source_kind: 'low_quiz', severity: 'urgent', created_at: '2026-06-22T00:00:00Z' },
  { id: '2', student_id: 's2', student_name: 'Alan Turing', source_kind: 'reteach_flag', severity: 'watch', created_at: '2026-06-22T00:00:00Z' },
];

describe('AlertsList — calm staggered arrival', () => {
  it('renders each alert row under reduced motion (snap to end state)', () => {
    render(<AlertsList alerts={rows} classId="c1" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  });
});
