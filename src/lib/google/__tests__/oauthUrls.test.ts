import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  process.env.GOOGLE_REDIRECT_URI = 'https://newcore.inteliflowai.com/api/auth/google/callback';
});

describe('buildConnectAuthUrl', () => {
  it('builds the consent URL with offline access, prompt=consent, scopes and state', async () => {
    const { buildConnectAuthUrl } = await import('@/lib/google/oauthUrls');
    const u = new URL(buildConnectAuthUrl('state-abc'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('state-abc');
    expect(u.searchParams.get('redirect_uri')).toBe('https://newcore.inteliflowai.com/api/auth/google/callback');
    expect(u.searchParams.get('scope')).toContain('classroom.coursework.students');
    expect(u.searchParams.get('scope')).toContain('drive.readonly');
  });
});
