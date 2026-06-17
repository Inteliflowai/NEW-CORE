import { describe, it, expect } from 'vitest';
import { SMOKE } from '@/lib/smoke';

describe('vitest smoke', () => {
  it('resolves the @/* alias and runs', () => {
    expect(SMOKE).toBe('ok');
  });
});
