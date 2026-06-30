import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';

export interface NextUpCardProps {
  id: string;
  title: string;
}

export function NextUpCard({ id, title }: NextUpCardProps): React.JSX.Element {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-fg text-xs font-bold uppercase tracking-wide">Next up</p>
          <p className="text-fg text-sm font-semibold">{title}</p>
        </div>
        <Link
          href={`/student/assignments/${id}`}
          className="shrink-0 rounded bg-brand px-3 py-1.5 text-fg-on-brand text-xs font-bold hover:opacity-90"
        >
          Start
        </Link>
      </div>
    </Card>
  );
}

export default NextUpCard;
