'use client';
// PrintButton — triggers window.print() for the parent report.
// Hidden on print itself via the `print:hidden` Tailwind utility.

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center gap-2 rounded-lg border border-surface bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      Print / Save as PDF
    </button>
  );
}
