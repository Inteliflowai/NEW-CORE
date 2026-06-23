'use client';

/** Shared Content Studio modal: role="dialog", focus trap, Escape-to-close, click-scrim-to-close,
 *  focus restoration to the trigger. Extracted from UploadStudio so UrlImportStudio reuses it. */
import React, { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export interface DupModalProps {
  testId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function DupModal({ testId, title, onClose, children }: DupModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => { triggerRef.current?.focus?.(); };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-fg/30" />
      <div
        ref={panelRef} data-testid={testId} role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}
        className="fixed left-1/2 top-1/2 z-30 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-extrabold text-fg">{title}</h2>
          <button
            type="button" ref={closeRef} onClick={onClose} aria-label="Close"
            className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >✕</button>
        </div>
        {children}
      </div>
    </>
  );
}

export default DupModal;
