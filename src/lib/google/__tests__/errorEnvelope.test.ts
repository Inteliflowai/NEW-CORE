import { describe, it, expect, vi } from 'vitest';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';

describe('gcErrorResponse', () => {
  it('maps GoogleNotConnectedError → 200 { connected:false }', async () => {
    const res = gcErrorResponse(new GoogleNotConnectedError());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });
  it('maps GoogleScopeError → 200 { connected:true, needsReconnect:true }', async () => {
    const res = gcErrorResponse(new GoogleScopeError());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true, needsReconnect: true });
  });
  it('maps anything else → 500 with NO raw error leak', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = gcErrorResponse(new Error('secret internal detail'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
    expect(body).toEqual({ error: 'Internal Server Error' });
    spy.mockRestore();
  });
});
