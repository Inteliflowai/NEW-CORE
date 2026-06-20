import { describe, it, expect, vi } from 'vitest';
import { getSparkLink, isSparkEnabled, provisionSparkLink } from '../sparkLink';

function adminWithLink(row: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  return { from: vi.fn(() => chain) } as never;
}

describe('getSparkLink / isSparkEnabled', () => {
  it('returns the row when an enabled spark link exists', async () => {
    const admin = adminWithLink({ api_key: 'k', core_base_url: 'https://x', enabled: true });
    expect(await getSparkLink(admin, 's1')).toEqual({ api_key: 'k', core_base_url: 'https://x', enabled: true });
    expect(await isSparkEnabled(admin, 's1')).toBe(true);
  });
  it('returns null when the link is disabled or absent', async () => {
    expect(await getSparkLink(adminWithLink({ api_key: 'k', core_base_url: null, enabled: false }), 's1')).toBeNull();
    expect(await getSparkLink(adminWithLink(null), 's1')).toBeNull();
    expect(await isSparkEnabled(adminWithLink(null), 's1')).toBe(false);
  });
});

describe('provisionSparkLink', () => {
  it('upserts product=spark on (school_id, product) and throws on error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = { from: vi.fn(() => ({ upsert })) } as never;
    await provisionSparkLink(admin, { schoolId: 's1', apiKey: 'k', coreBaseUrl: 'https://x', label: 'L' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ school_id: 's1', product: 'spark', api_key: 'k', enabled: true }),
      { onConflict: 'school_id,product' },
    );

    const failAdmin = { from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) })) } as never;
    await expect(provisionSparkLink(failAdmin, { schoolId: 's1', apiKey: 'k' })).rejects.toThrow(/boom/);
  });
});
