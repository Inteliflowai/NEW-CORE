'use client';

/**
 * ReadAloudButton — plays a passage aloud (OpenAI TTS via /api/attempts/tts), toggling play/stop.
 * Fires onPlay once on the first successful play so the player can count it (ttsPlayCount). Returns
 * null when there is nothing to read. Token-only; deep-ink. Strings DRAFT → Barb.
 *
 * Lifecycle: the <audio> element and its blob object URL are released on unmount (so playback
 * stops and the URL is revoked when the student leaves the page), and on every failure path; a
 * mountedRef bails if the TTS fetch resolves after unmount so no orphan audio starts.
 */
import React, { useEffect, useRef, useState } from 'react';

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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const audio = audioRef.current;
      if (audio) { audio.pause(); audio.src = ''; }
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
      audioRef.current = null;
    };
  }, []);

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
      if (!mountedRef.current) return;
      if (!res.ok) { setState('error'); return; }
      const blob = await res.blob();
      if (!mountedRef.current) return;
      // Revoke any prior URL before allocating a new one (failed/re-triggered play).
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { cleanup(); setState('idle'); };
      audio.onerror = () => { cleanup(); setState('error'); };
      await audio.play();
      if (!mountedRef.current) { audio.pause(); cleanup(); return; }
      if (!playedOnce.current) { playedOnce.current = true; onPlay?.(); }
      setState('playing');
    } catch {
      cleanup();
      if (mountedRef.current) setState('error');
    }
  }

  const loading = state === 'loading';
  const playing = state === 'playing';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={play}
        aria-pressed={playing}
        aria-busy={loading}
        aria-label={loading ? 'Loading audio' : playing ? 'Stop' : label}
        className="inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span aria-hidden="true">🔊</span>
        {loading ? 'Loading…' : playing ? 'Stop' : label}
      </button>
      {state === 'error' && <span role="alert" className="text-sm text-fg">Couldn&apos;t play that — try again.</span>}
    </div>
  );
}

export default ReadAloudButton;
