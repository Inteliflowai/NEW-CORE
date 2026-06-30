import React from 'react';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentNotesPaged } from '@/lib/highfives/loadStudentNotesPaged';
import { EmptyState } from '@/components/core/EmptyState';
import { NoteCard } from './_components/NoteCard';

const PAGE_SIZE = 20;

export default async function StudentNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const sp = await searchParams;
  const parsed = parseInt(sp.page ?? '1', 10);
  const page = Math.max(1, Number.isNaN(parsed) ? 1 : parsed);
  const { notes, totalCount } = await loadStudentNotesPaged(admin, userId, page, PAGE_SIZE);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">Notes from your teacher</h1>
      {notes.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="No notes yet"
          bodyOverride="Your teacher hasn't sent a note yet — keep up the great work!"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((n) => (
            <NoteCard key={n.id} text={n.note_text} createdAt={n.created_at} />
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <nav aria-label="Note pages" className="flex gap-4 justify-center pt-2 text-sm">
          {page > 1 && (
            <Link href={`/student/notes?page=${page - 1}`} className="text-brand underline">
              Previous
            </Link>
          )}
          <span className="text-fg-muted">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={`/student/notes?page=${page + 1}`} className="text-brand underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
