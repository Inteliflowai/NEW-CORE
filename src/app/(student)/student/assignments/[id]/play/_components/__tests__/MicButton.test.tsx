// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MicButton from '../MicButton';

let recorder: { start: () => void; stop: () => void; state: string; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void };

class FakeRecorder {
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { recorder = this as never; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); this.onstop?.(); }
  static isTypeSupported() { return true; }
}

beforeEach(() => {
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
  };
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ transcript: 'spoken words' }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('MicButton', () => {
  it('renders null when MediaRecorder is unavailable', () => {
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = undefined;
    const { container } = render(<MicButton onTranscript={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('records, stops, transcribes, and calls onTranscript', async () => {
    const onTranscript = vi.fn();
    render(<MicButton onTranscript={onTranscript} label="Dictate" />);
    fireEvent.click(screen.getByRole('button', { name: /dictate/i }));         // start
    await waitFor(() => expect(recorder.state).toBe('recording'));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));            // stop → transcribe
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('spoken words'));
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});
