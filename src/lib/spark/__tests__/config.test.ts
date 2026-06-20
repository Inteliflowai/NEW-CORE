import { describe, it, expect } from 'vitest';

describe('spark/config', () => {
  it('defaults SPARK_API_URL to the prod SPARK host when env is unset', async () => {
    delete process.env.SPARK_API_URL;
    const { SPARK_API_URL } = await import('../config');
    expect(SPARK_API_URL).toBe('https://spark.inteliflowai.com');
  });

  it('CORE_SPARK_API_SECRET falls back to empty string when unset', async () => {
    const { CORE_SPARK_API_SECRET } = await import('../config');
    expect(typeof CORE_SPARK_API_SECRET).toBe('string');
  });
});
