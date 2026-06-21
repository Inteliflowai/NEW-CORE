// src/app/(student)/student/assignments/[id]/play/page.tsx
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadAssignmentForPlay } from '@/lib/assignments/loadAssignmentForPlay';
import { EmptyState } from '@/components/core/EmptyState';
import { AssignmentPlayer } from './_components/AssignmentPlayer';

export default async function AssignmentPlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const data = await loadAssignmentForPlay(admin, userId, id);

  if (!data.ownershipOk) return <EmptyState variant="just-getting-started" titleOverride="Assignment not found" bodyOverride="Head back to your assignments list." />;
  if (data.sparkBlocked) return <EmptyState variant="just-getting-started" titleOverride="This one opens as a Challenge" bodyOverride="Open it from your assignments list to launch the challenge." />;
  if (data.gradedLocked) return <EmptyState variant="just-getting-started" titleOverride="Already turned in" bodyOverride="You've finished this one. Your teacher can reopen it if you need another try." />;

  return <AssignmentPlayer assignmentId={data.assignment.id} attemptId={data.attempt.id} content={data.assignment.content} initialResponses={data.attempt.responses} />;
}
