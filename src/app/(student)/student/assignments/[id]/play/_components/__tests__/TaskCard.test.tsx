// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskCard } from '../TaskCard';

const base = { step: 1, description: 'Sketch the force diagram.', value: '', onChange: () => {}, onFirstInput: () => {} };

// ── MicButton stubs (mirrors MicButton.test.tsx) ──────────────────────────────
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
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ transcript: 'my spoken answer' }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('TaskCard image affordance', () => {
  it('offers drawing + photo when no image is attached', () => {
    render(<TaskCard {...base} imageUrl={null} onSaveImage={async () => {}} onRemoveImage={() => {}} />);
    expect(screen.getByRole('button', { name: /add a drawing/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/add a photo/i)).toBeInTheDocument();
  });
  it('shows a preview + Remove when an image is attached', () => {
    const onRemoveImage = vi.fn();
    render(<TaskCard {...base} imageUrl="/api/attempts/drawing?path=stu1%2FA1%2Ftask-1-1.png" onSaveImage={async () => {}} onRemoveImage={onRemoveImage} />);
    expect(screen.getByRole('img', { name: /your drawing or photo/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemoveImage).toHaveBeenCalled();
  });
  it('opening the canvas and using a drawing calls onSaveImage with a Blob', async () => {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['x'], { type: 'image/png' })); };
    const onSaveImage = vi.fn(async (_blob: Blob) => {});
    render(<TaskCard {...base} imageUrl={null} onSaveImage={onSaveImage} onRemoveImage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add a drawing/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use this drawing/i }));
    await waitFor(() => expect(onSaveImage).toHaveBeenCalledTimes(1));
    expect(onSaveImage.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it('dictation appends the transcript via onChange', async () => {
    const onChange = vi.fn();
    render(<TaskCard {...base} value="Already typed." onChange={onChange} imageUrl={null} onSaveImage={async () => {}} onRemoveImage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /speak your answer/i }));
    // wait for getUserMedia to resolve and recording to begin before stopping
    await waitFor(() => expect(recorder.state).toBe('recording'));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Already typed. my spoken answer'));
  });
});
