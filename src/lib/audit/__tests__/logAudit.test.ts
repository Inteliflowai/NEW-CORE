// src/lib/audit/__tests__/logAudit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { logAudit } from '@/lib/audit/logAudit';

function makeAdmin(insertImpl: (rows: unknown) => unknown) {
  const calls: unknown[] = [];
  const admin = { from: (t: string) => ({ insert: (rows: unknown) => { calls.push({ t, rows }); return insertImpl(rows); } }) } as never;
  return { admin, calls };
}

describe('logAudit', () => {
  it('inserts a normalized row into audit_logs', async () => {
    const { admin, calls } = makeAdmin(async () => ({ error: null }));
    await logAudit(admin, { actorId: 'u1', schoolId: 's1', action: 'grade.override', resourceType: 'homework_attempt', resourceId: 'a1', metadata: { before: { x: 1 }, after: { x: 2 } } });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { t: string }).t).toBe('audit_logs');
    expect((calls[0] as { rows: Record<string, unknown> }).rows).toMatchObject({
      actor_id: 'u1', school_id: 's1', action: 'grade.override', resource_type: 'homework_attempt', resource_id: 'a1',
    });
  });
  it('defaults metadata to {} and allows null actor (system/cron)', async () => {
    const { admin, calls } = makeAdmin(async () => ({ error: null }));
    await logAudit(admin, { actorId: null, schoolId: 's1', action: 'roster.sync', resourceType: 'class', resourceId: 'c1' });
    expect((calls[0] as { rows: Record<string, unknown> }).rows).toMatchObject({ actor_id: null, metadata: {} });
  });
  it('NEVER throws when the insert returns an error', async () => {
    const { admin } = makeAdmin(async () => ({ error: { message: 'boom' } }));
    await expect(logAudit(admin, { actorId: 'u1', schoolId: 's1', action: 'x', resourceType: 'y', resourceId: null })).resolves.toBeUndefined();
  });
  it('NEVER throws when the insert itself throws', async () => {
    const { admin } = makeAdmin(() => { throw new Error('network'); });
    await expect(logAudit(admin, { actorId: 'u1', schoolId: 's1', action: 'x', resourceType: 'y', resourceId: null })).resolves.toBeUndefined();
  });
});
