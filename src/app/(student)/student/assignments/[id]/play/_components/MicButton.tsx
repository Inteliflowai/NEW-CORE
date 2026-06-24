'use client';

/**
 * MicButton — tap to record speech; the recording is transcribed to text (OpenAI Whisper via
 * /api/attempts/transcribe) and handed to onTranscript (the caller appends it). Renders null when
 * the browser lacks getUserMedia/MediaRecorder, so typing always remains the path. Token-only;
 * deep-ink; reduced-motion-safe. Strings DRAFT → Barb.
 *
 * Lifecycle: the live mic stream, the recorder, and the 60s auto-stop timer are all released on
 * unmount (the privacy-grade "mic light stays on" leak) and on every failure path; a transient
 * 'starting' state covers the getUserMedia await so a click during the permission prompt can't
 * strand the UI in 'recording'; a mountedRef bails if the permission resolves after unmount.
 */
import React, { useEffect, useRef, useState } from 'react';

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
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'working' | 'error'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const supportedRef = useRef<boolean>(micSupported());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
      const rec = recorderRef.current;
      if (rec) {
        // Detach so teardown doesn't fire an orphan transcribe on an unmounted component.
        rec.onstop = null;
        rec.ondataavailable = null;
        if (rec.state !== 'inactive') { try { rec.stop(); } catch { /* already torn down */ } }
      }
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  if (!supportedRef.current) return null;

  async function transcribe(blob: Blob) {
    try {
      const form = new FormData();
      form.append('file', blob, blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm');
      const res = await fetch('/api/attempts/transcribe', { method: 'POST', body: form });
      if (!mountedRef.current) return;
      if (!res.ok) { setState('error'); return; }
      const body = (await res.json()) as { transcript?: string };
      if (!mountedRef.current) return;
      const text = (body.transcript ?? '').trim();
      if (text) onTranscript(text);
      setState('idle');
    } catch { if (mountedRef.current) setState('error'); }
  }

  async function start() {
    if (disabled || (state !== 'idle' && state !== 'error')) return;
    setState('starting');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        void transcribe(blob);
      };
      streamRef.current = stream;
      recorderRef.current = rec;
      rec.start();
      stopTimerRef.current = setTimeout(() => stop(), MAX_MS);
      setState('recording');
    } catch {
      // MediaRecorder construction / rec.start() can throw after the stream is live — release it.
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      if (mountedRef.current) setState('error');
    }
  }

  function stop() {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { setState('working'); rec.stop(); }
  }

  const recording = state === 'recording';
  const working = state === 'working';
  const starting = state === 'starting';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled || working || starting}
        aria-pressed={recording}
        aria-busy={working || starting}
        aria-label={recording ? 'Stop recording' : working ? 'Transcribing' : starting ? 'Starting' : label}
        className={[
          'inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge px-3 py-1 text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
          recording ? 'bg-warn-surface text-fg motion-safe:animate-pulse' : 'bg-surface text-fg',
        ].join(' ')}
      >
        <span aria-hidden="true">🎤</span>
        {working ? 'Transcribing…' : recording ? 'Stop' : starting ? 'Starting…' : label}
      </button>
      {state === 'error' && <span role="alert" className="text-sm text-fg">Didn&apos;t catch that — try again.</span>}
    </div>
  );
}

export default MicButton;
