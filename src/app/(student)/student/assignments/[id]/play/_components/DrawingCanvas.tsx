'use client';

/**
 * DrawingCanvas — a lean draw pad for a student answer: pen/eraser, a few colors + widths,
 * undo, clear. Native HTML5 canvas (no dependency); mouse + touch via pointer events.
 * "Use this drawing" exports a PNG Blob the player uploads. Token-only; deep-ink.
 * jsdom-safe: every getContext('2d') is null-guarded so the component mounts in tests.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface DrawingCanvasProps {
  onComplete: (blob: Blob) => void;
  onCancel: () => void;
  onDraw?: () => void;
  width?: number;
  height?: number;
}

const COLORS = ['#1b1b1f', '#2563eb', '#dc2626', '#16a34a']; // ink/cobalt/red/green — canvas pixels, not UI tokens
const COLOR_NAMES = ['Black', 'Blue', 'Red', 'Green']; // index-aligned with COLORS — accessible names
const WIDTHS = [2, 4, 7];
const WIDTH_NAMES = ['Thin pen', 'Medium pen', 'Thick pen']; // index-aligned with WIDTHS — accessible names
const MAX_UNDO = 20;

export function DrawingCanvas({ onComplete, onCancel, onDraw, width = 560, height = 340 }: DrawingCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drewOnce = useRef(false);
  const undoStack = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);

  // Prime a white background so the exported PNG isn't transparent.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }, [width, height]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  }
  function pushUndo() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    try {
      undoStack.current.push(ctx.getImageData(0, 0, width, height));
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    } catch { /* jsdom getImageData unsupported — skip */ }
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    pushUndo();
    drawing.current = true;
    if (!drewOnce.current) { drewOnce.current = true; onDraw?.(); }
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current?.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth = tool === 'eraser' ? strokeWidth * 6 : strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function onPointerUp() { drawing.current = false; }

  function undo() {
    const ctx = canvasRef.current?.getContext('2d');
    const prev = undoStack.current.pop();
    if (ctx && prev) { try { ctx.putImageData(prev, 0, 0); } catch { /* jsdom */ } }
  }
  function clear() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    pushUndo();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  function complete() {
    const c = canvasRef.current;
    if (!c) { return; }
    c.toBlob((blob) => { if (blob) onComplete(blob); }, 'image/png');
  }

  const toolBtn = (active: boolean) =>
    `rounded-md border-2 border-sidebar-edge px-3 py-1 text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${active ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg'}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-3 shadow-sticker">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} className={toolBtn(tool === 'pen')}>Pen</button>
        <button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} className={toolBtn(tool === 'eraser')}>Eraser</button>
        <span className="mx-1 inline-flex gap-1" role="group" aria-label="Color">
          {COLORS.map((c, i) => (
            <button key={c} type="button" aria-label={`${COLOR_NAMES[i]} pen`} aria-pressed={color === c} onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-fg' : 'border-sidebar-edge'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`} />
          ))}
        </span>
        <span className="mx-1 inline-flex gap-1" role="group" aria-label="Stroke width">
          {WIDTHS.map((w, i) => (
            <button key={w} type="button" aria-label={WIDTH_NAMES[i]} aria-pressed={strokeWidth === w} onClick={() => setStrokeWidth(w)} className={toolBtn(strokeWidth === w)}>{w}</button>
          ))}
        </span>
        <button type="button" onClick={undo} className={toolBtn(false)}>Undo</button>
        <button type="button" onClick={clear} className={toolBtn(false)}>Clear</button>
      </div>

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        aria-label="Drawing canvas"
        className="w-full touch-none rounded-md border-2 border-sidebar-edge bg-bg"
        style={{ aspectRatio: `${width} / ${height}` }}
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={complete} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Use this drawing</button>
        <button type="button" onClick={onCancel} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Cancel</button>
      </div>
    </div>
  );
}

export default DrawingCanvas;
