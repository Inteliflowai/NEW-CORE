// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingCanvas from '../DrawingCanvas';

describe('DrawingCanvas', () => {
  it('renders the lean toolbar (pen, eraser, undo, clear) + actions', () => {
    render(<DrawingCanvas onComplete={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /pen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /eraser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use this drawing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<DrawingCanvas onComplete={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
  it('Use this drawing calls onComplete with a Blob (toBlob is stubbed in jsdom)', async () => {
    const onComplete = vi.fn();
    // jsdom HTMLCanvasElement.toBlob may be absent — stub it to invoke the callback with a PNG blob.
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['x'], { type: 'image/png' })); };
    render(<DrawingCanvas onComplete={onComplete} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /use this drawing/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});
