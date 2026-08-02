"use client";

/** Opens the browser's print dialog — where the proposal becomes a PDF. */
export function PrintButton() {
  return (
    <button type="button" className="sf-btn-brand px-4 py-2 text-sm" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
