import { describe, it, expect } from 'vitest';
import { buildLaunchAuthUrl } from '@/lib/google/oauthUrls';
import { LAUNCH_SCOPES } from '@/lib/google/config';

describe('buildLaunchAuthUrl', () => {
  it('identity scopes only (no classroom scopes)', () => {
    expect(LAUNCH_SCOPES).toEqual(['openid', 'email', 'profile']);
    const url = buildLaunchAuthUrl('launch:abc', 'silent');
    const sp = new URL(url).searchParams;
    expect(sp.get('scope')).toBe('openid email profile');
    expect(sp.get('scope')).not.toContain('classroom');
  });
  it('silent mode uses prompt=none', () => {
    const sp = new URL(buildLaunchAuthUrl('launch:abc', 'silent')).searchParams;
    expect(sp.get('prompt')).toBe('none');
    expect(sp.get('response_type')).toBe('code');
    expect(sp.get('state')).toBe('launch:abc');
  });
  it('interactive mode uses prompt=select_account', () => {
    const sp = new URL(buildLaunchAuthUrl('launch:abc', 'interactive')).searchParams;
    expect(sp.get('prompt')).toBe('select_account');
  });
  it('targets the Google consent endpoint', () => {
    expect(buildLaunchAuthUrl('launch:abc', 'silent')).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  });
});
