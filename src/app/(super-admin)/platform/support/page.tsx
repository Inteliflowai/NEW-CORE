// src/app/(super-admin)/platform/support/page.tsx
// Platform-admin support ticket inbox.
// Auth: requireRole(['platform_admin']) — redirects on failure.
// Pre-loads the first 20 open tickets (with description + screenshot_path so TicketDetail
// never needs a separate ticket fetch after a tab-change that includes the initial view).
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/requireRole';
import { TicketInbox } from './_components/TicketInbox';
import type { TicketRow } from './_components/TicketInbox';

export default async function SupportInboxPage() {
  const ctx = await requireRole(['platform_admin']);
  const admin = createAdminSupabaseClient();

  const { data: tickets } = await admin
    .from('support_tickets')
    .select(
      'id, subject, category, priority, status, submitted_by_role, school_id, created_at, assigned_to, description, screenshot_path',
    )
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <main className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <div className="px-6 py-4 border-b-2 border-sidebar-edge shrink-0">
        <h1 className="font-display text-2xl font-extrabold text-fg">Support Inbox</h1>
      </div>
      <div className="flex-1 min-h-0">
        <TicketInbox
          initialTickets={(tickets ?? []) as TicketRow[]}
          adminId={ctx.userId}
        />
      </div>
    </main>
  );
}
