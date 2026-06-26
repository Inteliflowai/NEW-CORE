// src/app/(school-admin)/_components/PickASchool.tsx
// Shown to platform_admin when no ?school= is in the URL.
// Calm, directive state — links to the Schools directory.
import Link from 'next/link';
import { Card } from '@/components/core/Card';

export function PickASchool() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Card className="max-w-sm w-full text-center space-y-4">
        <div className="text-4xl" aria-hidden="true">◇</div>
        <h2 className="text-fg font-display text-lg font-semibold">
          Select a school
        </h2>
        <p className="text-fg-muted text-sm leading-relaxed">
          Choose a school from the directory to view its overview.
        </p>
        <Link
          href="/schools"
          className="inline-block mt-2 rounded-md bg-brand px-4 py-2 text-fg-on-brand text-sm font-semibold border-2 border-sidebar-edge shadow-sticker hover:opacity-90 transition-opacity"
        >
          Go to Schools
        </Link>
      </Card>
    </div>
  );
}

export default PickASchool;
