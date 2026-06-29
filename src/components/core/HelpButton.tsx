'use client';
import { useState } from 'react';
import { HelpTicketModal } from './HelpTicketModal';

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-brand text-bg shadow-sticker
                   flex items-center justify-center text-xl font-bold
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label="Get help or report an issue"
      >
        ?
      </button>
      {open && <HelpTicketModal onClose={() => setOpen(false)} />}
    </>
  );
}
