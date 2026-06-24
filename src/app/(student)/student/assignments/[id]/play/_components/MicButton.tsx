'use client';

/**
 * MicButton — tap to record speech; the recording is transcribed to text (OpenAI Whisper via
 * /api/attempts/transcribe) and handed to onTranscript (the caller appends it). Renders null when
 * the browser lacks getUserMedia/MediaRecorder, so typing always remains the path. Token-only;
 * deep-ink; reduced-motion-safe. Strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';

export interface MicButtonProps {
  onTranscript: (text: string) => void;
  label?: string;
  disabled?: boolean;
}

const MAX_MS = 60_000;

function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' && typeof (window as { MediaRecorder?: unknown }).MediaRecorder !== 'undefined'
  );
}

export function MicButton({ onTranscript, label = 'Dictate', disabled }: MicButtonProps): React.JSX.Element | null {
  const [state, setState] = useState<'idle' | 'recording' | 'working' | 'error'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportedRef = useRef<boolean>(micSupported());

  if (!supportedRef.current) return null;

  async function transcribe(blob: Blob) {
    try {
      const form = new FormData();
      form.append('file', blob, blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm');
      const res = await fetch('/api/attempts/transcribe', { method: 'POST', body: form });
      if (!res.ok) { setState('error'); return; }
      const body = (await res.json()) as { transcript?: string };
      const text = (body.transcript ?? '').trim();
      if (text) onTranscript(text);
      setState('idle');
    } catch { setState('error'); }
  }

  async function start() {
    if (disabled || state === 'recording' || state === 'working') return;
    setState('recording');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void transcribe(new Blob(chunksRef.current, { type: mime }));
      };
      recorderRef.current = rec;
      rec.start();
      stopTimerRef.current = setTimeout(() => stop(), MAX_MS);
    } catch { setState('error'); }
  }

  function stop() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { setState('working'); rec.stop(); }
  }

  const recording = state === 'recording';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled || state === 'working'}
        aria-pressed={recording}
        aria-label={recording ? 'Stop recording' : label}
        className={[
          'inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge px-3 py-1 text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
          recording ? 'bg-warn-surface text-fg motion-safe:animate-pulse' : 'bg-surface text-fg',
        ].join(' ')}
      >
        <span aria-hidden="true">🎤</span>
        {state === 'working' ? 'Transcribing…' : recording ? 'Stop' : label}
      </button>
      {state === 'error' && <span role="alert" className="text-sm text-fg-muted">Didn&apos;t catch that — try again.</span>}
    </div>
  );
}

export default MicButton;
