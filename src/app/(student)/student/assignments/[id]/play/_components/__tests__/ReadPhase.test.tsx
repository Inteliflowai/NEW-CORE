// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReadPhase } from '../ReadPhase';

const origPlay = HTMLMediaElement.prototype.play;
const origPause = HTMLMediaElement.prototype.pause;
const origCreate = globalThis.URL.createObjectURL;
const origRevoke = globalThis.URL.revokeObjectURL;
afterEach(() => {
  HTMLMediaElement.prototype.play = origPlay;
  HTMLMediaElement.prototype.pause = origPause;
  globalThis.URL.createObjectURL = origCreate;
  globalThis.URL.revokeObjectURL = origRevoke;
  vi.restoreAllMocks();
});

describe('ReadPhase', () => {
  it('shows the assignment title and a Ready to start button', () => {
    render(
      <ReadPhase
        content={{ title: 'My Assignment', tasks: [{ step: 1, description: 'Do it' }] }}
        onStart={() => {}}
      />,
    );
    expect(screen.getByText('My Assignment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ready to start/i })).toBeInTheDocument();
  });

  it('reads the audio_script (not the written passage) and fires onTtsPlay when played', async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }), { status: 200 })) as unknown as typeof fetch;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()); HTMLMediaElement.prototype.pause = vi.fn();
    const onTtsPlay = vi.fn();
    render(<ReadPhase content={{ title: 'T', reading_passage: 'A passage to read.', audio_script: 'Spoken version.', tasks: [{ step: 1, description: 'q' }] }} onStart={() => {}} onTtsPlay={onTtsPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(onTtsPlay).toHaveBeenCalledTimes(1));
    // The conversational audio_script must be sent to TTS, NOT the written passage.
    const body = JSON.parse(((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body) as string);
    expect(body.text).toMatch(/Spoken version/);
    expect(body.text).not.toMatch(/A passage to read/);
  });
});
