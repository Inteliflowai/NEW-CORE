// src/lib/google/oauthUrls.ts
// Builds the Google OAuth consent URL for the per-teacher classroom connect (offline + consent).
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GC_SCOPES, LAUNCH_SCOPES } from '@/lib/google/config';

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

/** Build the silent-SSO launch consent URL. `silent` → prompt=none (no UI for a Classroom student
 *  already in their Google session); `interactive` → prompt=select_account (the one retry when
 *  Google returns interaction_required). Identity scopes only; the signed launch state rides in
 *  `state`. Same registered redirect_uri as the teacher connect (the one Google callback). */
export function buildLaunchAuthUrl(state: string, mode: 'silent' | 'interactive'): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: LAUNCH_SCOPES.join(' '),
    state,
    prompt: mode === 'silent' ? 'none' : 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
