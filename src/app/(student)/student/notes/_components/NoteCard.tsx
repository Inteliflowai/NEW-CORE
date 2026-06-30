import React from 'react';
import { Card } from '@/components/core/Card';

function shortNoteDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NoteCard({ text, createdAt }: { text: string; createdAt: string }): React.JSX.Element {
  return (
    <Card tone="brand">
      <div className="flex flex-col gap-1">
        <p className="text-fg text-sm leading-relaxed">{text}</p>
        <p className="text-fg-muted text-xs">{shortNoteDate(createdAt)}</p>
      </div>
    </Card>
  );
}

export default NoteCard;
