// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReadAloudButton from '../ReadAloudButton';

// Capture jsdom originals so every test restores the prototype/global stubs it mutates.
const origPlay = HTMLMediaElement.prototype.play;
const origPause = HTMLMediaElement.prototype.pause;
const origCreate = globalThis.URL.createObjectURL;
const origRevoke = globalThis.URL.revokeObjectURL;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }), { status: 200 })) as unknown as typeof fetch;
  // jsdom: stub the unsupported media + URL bits.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => {
  HTMLMediaElement.prototype.play = origPlay;
  HTMLMediaElement.prototype.pause = origPause;
  globalThis.URL.createObjectURL = origCreate;
  globalThis.URL.revokeObjectURL = origRevoke;
  vi.restoreAllMocks();
});

describe('ReadAloudButton', () => {
  it('renders null for empty text', () => {
    const { container } = render(<ReadAloudButton text="   " />);
    expect(container.firstChild).toBeNull();
  });
  it('fetches TTS, plays, and sends the passage text', async () => {
    render(<ReadAloudButton text="Read this passage aloud." label="Listen" />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    const body = JSON.parse(((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body) as string);
    expect(body.text).toMatch(/Read this passage/);
  });
  it('fires onPlay only once across a stop + replay cycle', async () => {
    const onPlay = vi.fn();
    render(<ReadAloudButton text="Read this passage aloud." onPlay={onPlay} label="Listen" />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));            // play 1
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument());
    expect(onPlay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));            // stop
    await waitFor(() => expect(screen.getByRole('button', { name: /listen/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));            // play 2
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument());
    expect(onPlay).toHaveBeenCalledTimes(1);                                     // still once
  });
  it('shows an error message and does not fire onPlay when TTS fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('err', { status: 503 })) as unknown as typeof fetch;
    const onPlay = vi.fn();
    render(<ReadAloudButton text="Read this." onPlay={onPlay} label="Listen" />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t play/i));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /listen/i })).toBeInTheDocument();
  });
  it('pauses playback and revokes the object URL on unmount', async () => {
    const { unmount } = render(<ReadAloudButton text="Read this." label="Listen" />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument());
    unmount();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
