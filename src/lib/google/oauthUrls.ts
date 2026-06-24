// src/lib/google/oauthUrls.ts
// Builds the Google OAuth consent URL for the per-teacher classroom connect (offline + consent).
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GC_SCOPES } from '@/lib/google/config';

export function buildConnectAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GC_SCOPES.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
