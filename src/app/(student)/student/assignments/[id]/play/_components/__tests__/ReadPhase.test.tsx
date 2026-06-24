// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReadPhase } from '../ReadPhase';

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

  it('shows a Listen button on the passage and fires onTtsPlay when played', async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }), { status: 200 })) as unknown as typeof fetch;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()); HTMLMediaElement.prototype.pause = vi.fn();
    const onTtsPlay = vi.fn();
    render(<ReadPhase content={{ title: 'T', reading_passage: 'A passage to read.', audio_script: 'Spoken version.', tasks: [{ step: 1, description: 'q' }] }} onStart={() => {}} onTtsPlay={onTtsPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(onTtsPlay).toHaveBeenCalledTimes(1));
  });
});
