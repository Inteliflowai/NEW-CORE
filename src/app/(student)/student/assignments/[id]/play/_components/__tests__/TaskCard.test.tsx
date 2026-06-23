// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskCard } from '../TaskCard';

const base = { step: 1, description: 'Sketch the force diagram.', value: '', onChange: () => {}, onFirstInput: () => {} };

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
    const onSaveImage = vi.fn(async () => {});
    render(<TaskCard {...base} imageUrl={null} onSaveImage={onSaveImage} onRemoveImage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add a drawing/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use this drawing/i }));
    await waitFor(() => expect(onSaveImage).toHaveBeenCalledTimes(1));
    expect(onSaveImage.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});
