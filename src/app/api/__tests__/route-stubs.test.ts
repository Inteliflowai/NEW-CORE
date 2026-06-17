import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STUBS = [
  // Brief-specified stubs
  'src/app/api/cron/trial-check/route.ts',
  'src/app/api/cron/idempotency-sweep/route.ts',
  'src/app/api/cron/weekly-snapshot/route.ts',
  'src/app/api/cron/parent-narrative/route.ts',
  'src/app/api/attempts/spark-attempt-complete/route.ts',
  'src/app/api/public/trial/signup/route.ts',
  'src/app/auth/callback/route.ts',
  // Correction-specified additional stubs
  'src/app/api/teacher/lessons/parse/route.ts',
  'src/app/api/attempts/[attemptId]/adapt/route.ts',
  'src/app/api/attempts/[attemptId]/submit/route.ts',
  'src/app/api/integrations/core/route.ts',
  'src/app/api/import/lift-inbound/route.ts',
  'src/app/api/cron/trial-expiry/route.ts',
  'src/app/api/cron/snapshot/route.ts',
];

describe('api route-stub tree (Turbopack trap mitigation)', () => {
  it('every known endpoint has a route.ts up front', () => {
    for (const p of STUBS) expect(existsSync(resolve(process.cwd(), p)), p).toBe(true);
  });
  it('the trial-signup stub returns 501', async () => {
    const mod = await import('@/app/api/public/trial/signup/route');
    const res = await mod.POST();
    expect(res.status).toBe(501);
  });
});
