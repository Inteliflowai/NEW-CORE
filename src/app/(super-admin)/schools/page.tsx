// src/app/(super-admin)/schools/page.tsx
// Super-admin school list. Role gate is in (super-admin)/layout.tsx (requireRole(['platform_admin'])).
// Reads all schools via the admin (service-role) client + checks each one's SPARK status via getSparkLink.
import React from 'react';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getSparkLink } from '@/lib/spark/sparkLink';
import { SparkEnableButton } from './_components/SparkEnableButton';

export default async function SchoolsPage(): Promise<React.JSX.Element> {
  const admin = createAdminSupabaseClient();
  const { data: schools } = await admin.from('schools').select('id, name, demo_mode').order('name');
  const rows = await Promise.all(
    (schools ?? []).map(async (s) => ({
      ...s,
      sparkEnabled: (await getSparkLink(admin, s.id as string)) !== null,
    })),
  );

  return (
    <main className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">Schools</h1>
      {rows.length === 0 ? (
        <p className="text-fg-muted text-sm">No schools found.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((s) => (
            <div
              key={s.id as string}
              className="flex items-center justify-between gap-4 rounded border border-surface bg-surface px-4 py-3"
            >
              <div className="flex flex-col">
                <span className="text-fg text-sm font-semibold">
                  {s.name as string}
                  {s.demo_mode ? ' (demo)' : ''}
                </span>
                <span className="text-fg-muted text-xs">
                  {s.sparkEnabled ? 'SPARK enabled' : 'SPARK not enabled'}
                </span>
              </div>
              <SparkEnableButton schoolId={s.id as string} enabled={s.sparkEnabled} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
