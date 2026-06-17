// src/lib/ai/errors.ts
// Terminal-failure contract substrate (spec §1.4 / §3.5). After primary+fallback
// both exhaust, wrappers throw this; route handlers (later plans) translate it to the
// standard error envelope, never a raw 500 with a partial body.
export class LlmExhaustedError extends Error {
  readonly provider: string;
  readonly cause?: unknown;
  constructor(provider: string, cause?: unknown) {
    super(`LLM exhausted after retries (provider=${provider})`);
    this.name = 'LlmExhaustedError';
    this.provider = provider;
    this.cause = cause;
  }
}
