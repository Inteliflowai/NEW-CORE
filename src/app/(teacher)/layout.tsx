// Route-group layout for the teacher role.
// Auth gate (requireRole) first, then the left-sidebar app shell (TeacherShell),
// which sets data-role="teacher" + data-intensity="calm" for token binding.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { TeacherShell } from './_components/TeacherShell';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { openAlertCountForTeacher } from '@/lib/alerts/openAlertCount';
import { HelpButton } from '@/components/core/HelpButton';

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { fullName, userId } = await requireRole(['teacher']);
  const admin = createAdminSupabaseClient();
  const [alertCount, avatarRow] = await Promise.all([
    openAlertCountForTeacher(admin, userId),
    admin.from('users').select('avatar_url').eq('id', userId).maybeSingle(),
  ]);
  const avatarUrl = (avatarRow.data?.avatar_url ?? null) as string | null;
  return (
    <>
      <TeacherShell userName={fullName} alertCount={alertCount} avatarUrl={avatarUrl}>
        {children}
      </TeacherShell>
      <HelpButton />
    </>
  );
}
