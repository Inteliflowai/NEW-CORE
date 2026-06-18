// src/lib/ai/__tests__/import-safety.test.ts
// Regression test for C18: AI clients must NOT throw at module-load time when the
// relevant env var is absent. Before the lazy-init fix, `new OpenAI({apiKey:undefined})`
// and `new Anthropic({apiKey:undefined})` would throw at import, breaking `npm run eval`
// and `npm run spike:grader` under tsx without keys.

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('import-safety (C18 regression)', () => {
  // Restore env even if an assertion throws — inline cleanup would be skipped on failure.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('importing @/lib/ai/openai without OPENAI_API_KEY does not throw', async () => {
    vi.resetModules();
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(import('@/lib/ai/openai')).resolves.toBeDefined();
  });

  it('importing @/lib/ai/claude without ANTHROPIC_API_KEY does not throw', async () => {
    vi.resetModules();
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(import('@/lib/ai/claude')).resolves.toBeDefined();
  });
});
