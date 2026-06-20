import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('provisionSparkSchool', () => {
  beforeEach(() => {
    process.env.SPARK_API_URL = 'https://spark.test';
    process.env.CORE_SPARK_API_SECRET = 'sek';
    vi.resetModules();
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs with Bearer + body and returns sparkSchoolId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, spark_school_id: 'ss-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { provisionSparkSchool } = await import('../provisionSparkSchool');
    const r = await provisionSparkSchool({ coreSchoolId: 'cs-1', name: 'Demo', coreBaseUrl: 'https://newcore.inteliflowai.com' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://spark.test/api/integration/provision-school');
    expect(init.headers.Authorization).toBe('Bearer sek');
    expect(JSON.parse(init.body)).toMatchObject({ core_school_id: 'cs-1', name: 'Demo', core_base_url: 'https://newcore.inteliflowai.com' });
    expect(r).toMatchObject({ success: true, sparkSchoolId: 'ss-1' });
  });

  it('returns success:false on non-OK / throw (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const { provisionSparkSchool } = await import('../provisionSparkSchool');
    expect((await provisionSparkSchool({ coreSchoolId: 'x', name: 'y' })).success).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const { provisionSparkSchool: p2 } = await import('../provisionSparkSchool');
    expect((await p2({ coreSchoolId: 'x', name: 'y' })).success).toBe(false);
  });
});
