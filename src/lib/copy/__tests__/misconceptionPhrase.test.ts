import { describe, it, expect } from 'vitest';
import { misconceptionPhrase } from '../misconceptionPhrase';
import { assertNoLeak } from '../leakGuard';

describe('misconceptionPhrase', () => {
  it('humanizes a snake_case error_type into readable words', () => {
    const out = misconceptionPhrase({ type: 'sign_error', count: 4 });
    expect(out.toLowerCase()).toContain('sign');
    // no snake_case left in output
    expect(out).not.toContain('_');
  });

  it('never prints a raw skill_id (only takes type+count, no skill_id arg)', () => {
    // The signature accepts only { type, count } — there is no skill_id to leak.
    const out = misconceptionPhrase({ type: 'misplaced_decimal', count: 3 });
    expect(out).not.toContain('skill');
  });

  it('returns a non-empty fallback for an empty/unknown type', () => {
    expect(misconceptionPhrase({ type: '', count: 0 }).length).toBeGreaterThan(0);
  });

  it('output passes assertNoLeak (the count is NOT printed — words only)', () => {
    expect(() => assertNoLeak(misconceptionPhrase({ type: 'sign_error', count: 5 }))).not.toThrow();
  });
});
