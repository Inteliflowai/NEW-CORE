// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';

describe('component test infra smoke', () => {
  it('renders a div and finds it by text', () => {
    render(<div>hello-world</div>);
    expect(screen.getByText('hello-world')).toBeInTheDocument();
  });
});
