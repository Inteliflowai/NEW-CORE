'use client';

/**
 * TaskCard — one assignment task: prompt (MathText) + a typed open-response, and an OPTIONAL
 * drawing/photo answer. A task is answerable by text, by image, or both (the submit gate accepts
 * either). The drawing canvas + photo write into the responses contract's existing `image_url`.
 * Token-only styling.
 */
import React, { useRef, useState } from 'react';
import { MathText } from '@/components/core/MathText';
import { DrawingCanvas } from './DrawingCanvas';
import MicButton from './MicButton';

export interface TaskCardProps {
  step: number;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onFirstInput: () => void;
  imageUrl: string | null;
  onSaveImage: (blob: Blob) => Promise<void>;
  onRemoveImage: () => void;
  onCanvasUsed?: () => void;
}

const IMG_TYPES = 'image/png,image/jpeg,image/webp';

export function TaskCard({ step, description, value, onChange, onFirstInput, imageUrl, onSaveImage, onRemoveImage, onCanvasUsed }: TaskCardProps) {
  const hasInputtedRef = useRef(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  // Dictation is async (record + network); read the LATEST answer text when the transcript
  // returns, not the snapshot captured when MicButton was created, so interim typing isn't lost.
  const valueRef = useRef(value);
  valueRef.current = value;

  function fireFirstInput() {
    if (!hasInputtedRef.current) { hasInputtedRef.current = true; onFirstInput(); }
  }
  async function save(blob: Blob) {
    setSaving(true); setImgError(null);
    try { await onSaveImage(blob); setShowCanvas(false); }
    catch { setImgError("That didn't attach — try again."); }
    finally { setSaving(false); }
  }
  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void save(f);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-fg-on-brand text-sm font-bold">{step}</span>
        <div className="text-fg text-base leading-relaxed font-medium pt-0.5"><MathText>{description}</MathText></div>
      </div>

      <textarea
        rows={6}
        value={value}
        onChange={(e) => { fireFirstInput(); onChange(e.target.value); }}
        onFocus={fireFirstInput}
        placeholder="Write your answer here…"
        style={{ resize: 'vertical' }}
        className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 placeholder:text-fg-muted"
        aria-label={`Answer for question ${step}`}
      />

      <div>
        <MicButton
          label={`Speak your answer for question ${step}`}
          onTranscript={(t) => { fireFirstInput(); const base = valueRef.current.trim(); onChange(base ? `${base} ${t}` : t); }}
        />
      </div>

      {/* Optional drawing / photo answer */}
      {imageUrl ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Your drawing or photo" className="max-h-72 w-auto rounded-lg border-2 border-sidebar-edge bg-bg" />
          <div>
            <button type="button" onClick={onRemoveImage} className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Remove</button>
          </div>
        </div>
      ) : showCanvas ? (
        <DrawingCanvas onComplete={(blob) => void save(blob)} onCancel={() => setShowCanvas(false)} onDraw={onCanvasUsed} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowCanvas(true)} disabled={saving} className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">Add a drawing</button>
          <label className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
            Add a photo
            <input type="file" accept={IMG_TYPES} onChange={onPhoto} disabled={saving} className="sr-only" aria-label="Add a photo" />
          </label>
          {saving && <span role="status" className="text-sm text-fg-muted">Attaching…</span>}
        </div>
      )}
      {imgError && <p role="alert" className="text-sm text-fg">{imgError}</p>}
    </div>
  );
}

export default TaskCard;
