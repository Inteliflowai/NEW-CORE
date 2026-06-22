import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { Card } from '@/components/core/Card';
import { loadStudentHighFives } from '@/lib/highfives/loadStudentHighFives';

export default async function StudentHome(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const notes = await loadStudentHighFives(admin, userId, 2);

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-fg text-xl font-semibold">Your CORE space</h1>
      {notes.length > 0 && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            {notes.map((n) => (
              <p key={n.id} className="text-fg text-base leading-relaxed">{n.note_text}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
