// Route-group layout for the customer-school admin surface.
import { AdminShell } from './_components/AdminShell';
import { requireRole } from '@/lib/auth/requireRole';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';
import { adminCapabilities } from '@/lib/auth/adminCapabilities';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const ROLE_LABEL: Record<string, string> = {
  school_admin: 'School Admin',
  school_sysadmin: 'IT Admin',
  platform_admin: 'Platform Admin',
};

export default async function SchoolAdminLayout({ children }: { children: React.ReactNode }) {
  const { role, fullName, userId } = await requireRole(SCHOOL_ADMIN_ROLES);
  const admin = createAdminSupabaseClient();
  const { data: avatarRow } = await admin.from('users').select('avatar_url').eq('id', userId).maybeSingle();
  const caps = adminCapabilities(role);
  return (
    <AdminShell
      userName={fullName}
      avatarUrl={(avatarRow?.avatar_url ?? null) as string | null}
      roleLabel={ROLE_LABEL[role] ?? 'Administrator'}
      canSeeStudentAttention={caps.canSeeStudentAttention}
    >
      {children}
    </AdminShell>
  );
}
