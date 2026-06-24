'use client';

/**
 * ReadAloudButton — plays a passage aloud (OpenAI TTS via /api/attempts/tts), toggling play/stop.
 * Fires onPlay once on the first successful play so the player can count it (ttsPlayCount). Returns
 * null when there is nothing to read. Token-only; deep-ink. Strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';

export interface ReadAloudButtonProps {
  text: string;
  onPlay?: () => void;
  label?: string;
}

const MAX_CHARS = 4096;

export function ReadAloudButton({ text, onPlay, label = 'Listen' }: ReadAloudButtonProps): React.JSX.Element | null {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const playedOnce = useRef(false);

  if (!text.trim()) return null;

  function cleanup() {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    audioRef.current = null;
  }
  function stop() {
    audioRef.current?.pause();
    cleanup();
    setState('idle');
  }

  async function play() {
    if (state === 'loading' || state === 'playing') { stop(); return; }
    setState('loading');
    try {
      const res = await fetch('/api/attempts/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, MAX_CHARS) }),
      });
      if (!res.ok) { setState('error'); return; }
      const url = URL.createObjectURL(await res.blob());
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { cleanup(); setState('idle'); };
      audio.onerror = () => { cleanup(); setState('error'); };
      await audio.play();
      if (!playedOnce.current) { playedOnce.current = true; onPlay?.(); }
      setState('playing');
    } catch { setState('error'); }
  }

  const active = state === 'playing' || state === 'loading';
  return (
    <button
      type="button"
      onClick={play}
      aria-pressed={active}
      aria-label={active ? 'Stop' : label}
      className="inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span aria-hidden="true">🔊</span>
      {state === 'loading' ? 'Loading…' : active ? 'Stop' : label}
    </button>
  );
}

export default ReadAloudButton;
