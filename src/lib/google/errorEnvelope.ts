// src/lib/google/errorEnvelope.ts
// Single-sourced GC route error envelope. The two typed Google errors become connected/reconnect
// signals (HTTP 200, so the UI can branch on the body); anything else is a generic 500 with the
// raw message logged but NEVER returned (no raw-error-string leak — the V1 import-roster bug).
import { NextResponse } from 'next/server';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

export function gcErrorResponse(err: unknown): NextResponse {
  if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
  if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
  console.error('[gc] route error:', err instanceof Error ? err.message : 'unknown');
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
