import React from 'react';
import type { Metadata } from 'next';

// Internal FEEL prototypes (mock data, no auth). Keep them out of search engines —
// they are reachable by direct URL for demos but should never be crawled/indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PrototypeLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
