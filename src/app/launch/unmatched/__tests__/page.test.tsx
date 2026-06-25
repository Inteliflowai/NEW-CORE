// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LaunchUnmatched from '@/app/launch/unmatched/page';

describe('/launch/unmatched', () => {
  it('shows the no-match message and a sign-in link to /login', () => {
    render(<LaunchUnmatched />);
    expect(screen.getByRole('heading')).toHaveTextContent(/couldn.t match/i);
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/login');
  });
});
