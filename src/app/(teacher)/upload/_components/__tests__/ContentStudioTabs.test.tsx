// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContentStudioTabs from '../ContentStudioTabs';

beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch; });

describe('ContentStudioTabs', () => {
  it('renders three tabs, Upload selected by default', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState={null} />);
    expect(screen.getByRole('tab', { name: /upload a file/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /from a url/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /generate with ai/i })).toBeInTheDocument();
    expect(screen.getByText(/drop a lesson here/i)).toBeInTheDocument(); // UploadStudio panel
  });

  it('switches to the URL tab on click', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /from a url/i }));
    expect(screen.getByLabelText(/link or web address/i)).toBeInTheDocument();
  });

  it('switches to the Generate tab and passes the school state', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState="TX" />);
    fireEvent.click(screen.getByRole('tab', { name: /generate with ai/i }));
    expect(screen.getByLabelText(/what should this lesson teach/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/state/i) as HTMLSelectElement).value).toBe('TX');
  });

  it('ArrowRight moves selection to the next tab', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState={null} />);
    const first = screen.getByRole('tab', { name: /upload a file/i });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /from a url/i })).toHaveAttribute('aria-selected', 'true');
  });
});
