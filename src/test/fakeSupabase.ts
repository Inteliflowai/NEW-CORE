// src/test/fakeSupabase.ts
// Minimal chainable Supabase query recorder for unit-testing loader IDOR scoping.
// Every builder method returns the same thenable object, so `await admin.from(t)
// .select(...).eq(...)...` resolves to the per-table result while recording calls.
export interface RecordedCall { method: string; args: unknown[] }
export interface RecordedQuery { __calls: RecordedCall[] }
export interface FakeAdmin {
  from(table: string): Record<string, unknown> & RecordedQuery;
  __used: Record<string, RecordedQuery>;
}

const CHAIN_METHODS = ['select', 'eq', 'gt', 'gte', 'lt', 'in', 'order', 'limit', 'maybeSingle', 'single'];

export function makeFakeAdmin(byTable: Record<string, { data: unknown }>): FakeAdmin {
  const used: Record<string, RecordedQuery> = {};
  return {
    from(table: string) {
      const calls: RecordedCall[] = [];
      const result = byTable[table] ?? { data: [] };
      const q: Record<string, unknown> & RecordedQuery = { __calls: calls };
      for (const m of CHAIN_METHODS) {
        q[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return q; };
      }
      // Thenable: `await q` (at any chain position) resolves to `result`.
      (q as unknown as { then: unknown }).then = (
        onF: (v: unknown) => unknown,
        onR?: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(onF, onR);
      used[table] = q;
      return q;
    },
    __used: used,
  };
}
