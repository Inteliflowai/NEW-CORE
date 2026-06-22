'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { ALERT_BUCKETS } from '@/lib/copy/alertTriggerLabel';
import { SectionLabel } from '../../_components/SectionLabel';
import { AlertRow, type AlertRowItem } from './AlertRow';

export function AlertsList({ alerts, classId }: { alerts: AlertRowItem[]; classId: string }): React.JSX.Element {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      {ALERT_BUCKETS.map((bucket) => {
        const rows = alerts.filter((a) => a.severity === bucket.severity);
        if (rows.length === 0) return null;
        return (
          <section key={bucket.severity} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <SectionLabel tone={bucket.severity === 'urgent' ? 'risk' : bucket.severity === 'watch' ? 'warn' : 'brand'}>{bucket.label}</SectionLabel>
              <span className="text-fg text-xs">{bucket.subline}</span>
            </div>
            {rows.map((a) => <AlertRow key={a.id} alert={a} classId={classId} onResolved={() => router.refresh()} />)}
          </section>
        );
      })}
    </div>
  );
}
export default AlertsList;
