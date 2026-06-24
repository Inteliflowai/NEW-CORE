// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReadAloudButton from '../ReadAloudButton';

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }), { status: 200 })) as unknown as typeof fetch;
  // jsdom: stub the unsupported media + URL bits.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

describe('ReadAloudButton', () => {
  it('renders null for empty text', () => {
    const { container } = render(<ReadAloudButton text="   " />);
    expect(container.firstChild).toBeNull();
  });
  it('fetches TTS, plays, and fires onPlay once', async () => {
    const onPlay = vi.fn();
    render(<ReadAloudButton text="Read this passage aloud." onPlay={onPlay} label="Listen" />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(onPlay).toHaveBeenCalledTimes(1);
    const body = JSON.parse(((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body) as string);
    expect(body.text).toMatch(/Read this passage/);
  });
});
