// Four count pills for the class band mix. Token-only; counts are teacher-only numbers (OK here).
import React from 'react';
import { Card } from '@/components/core/Card';
import { bandPillLabel, type BandMix as Mix } from '@/lib/copy/insightsObservation';

const TONE: Record<keyof Omit<Mix, 'total'>, 'warn' | 'ok' | 'brand' | 'surface'> = {
  needs_reinforcement: 'warn',
  on_track: 'ok',
  ready_to_enrich: 'brand',
  not_assessed: 'surface',
};

export function BandMix({ mix }: { mix: Mix }): React.JSX.Element {
  const keys: (keyof Omit<Mix, 'total'>)[] = ['needs_reinforcement', 'on_track', 'ready_to_enrich', 'not_assessed'];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {keys.map((k) => (
        <Card key={k} tone={TONE[k]}>
          <div className="flex flex-col gap-1">
            <span className="text-fg font-display text-3xl font-extrabold leading-none">{mix[k]}</span>
            <span className="text-fg text-sm font-semibold">{bandPillLabel(k)}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
export default BandMix;
