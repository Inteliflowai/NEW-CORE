// src/app/api/_lib/errorEnvelope.ts
// Standard error envelope (spec §3.5) + terminal-failure response mapper.
// All five engine routes use respondEngineError instead of raw 500s.
import { NextResponse } from 'next/server';
import { LlmExhaustedError } from '@/lib/ai/errors';

export interface ErrorEnvelope {
  error: { code: string; message: string; retryable: boolean; userMessage: string };
}

/** Build the standard §3.5 error envelope object. */
export function errorEnvelope(
  code: string,
  message: string,
  retryable: boolean,
  userMessage: string,
): ErrorEnvelope {
  return { error: { code, message, retryable, userMessage } };
}

/**
 * Map an engine/LLM failure to a NextResponse with the standard envelope.
 *
 * Mapping table (§3.5):
 * - LlmExhaustedError → 503 retryable=true  (terminal LLM exhaustion; attempt stays ungraded + re-queueable)
 * - Unknown/other     → 500 retryable=false  (generic engine error)
 *
 * Never returns a raw 500 with a partial body.
 */
export function respondEngineError(err: unknown): NextResponse {
  if (err instanceof LlmExhaustedError) {
    return NextResponse.json(
      errorEnvelope(
        'llm_exhausted',
        err.message,
        true,
        'The system is busy — please try again in a moment.',
      ),
      { status: 503 },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    errorEnvelope(
      'engine_error',
      message,
      false,
      'Something went wrong generating this. Please try again.',
    ),
    { status: 500 },
  );
}
