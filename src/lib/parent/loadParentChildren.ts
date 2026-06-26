import type { SupabaseClient } from '@supabase/supabase-js';

export interface ParentChild {
  id: string;
  firstName: string;
}

/**
 * Returns the children (students) linked to the given parent via `users.parent_id`.
 * Keyed off the same column used by `guardStudentAccess` (guards.ts:92-95).
 * Pure, admin-client-injected — caller is responsible for IDOR guards.
 */
export async function loadParentChildren(
  admin: SupabaseClient,
  parentId: string,
): Promise<ParentChild[]> {
  const { data } = await admin
    .from('users')
    .select('id, full_name')
    .eq('parent_id', parentId)
    .eq('role', 'student')
    .order('full_name', { ascending: true });

  const rows = (data ?? []) as { id: string; full_name: string | null }[];
  return rows.map((r) => {
    const first = r.full_name?.split(/\s+/)[0];
    return { id: r.id, firstName: first || 'Student' };
  });
}
