// src/app/(teacher)/import/google/page.tsx
// The Google Classroom import wizard is now hosted in the /import page's Google tab.
// Redirect any direct hits to /import so the full tablist is shown.
import { redirect } from 'next/navigation';

export default function GoogleImportPage(): never {
  redirect('/import');
}
