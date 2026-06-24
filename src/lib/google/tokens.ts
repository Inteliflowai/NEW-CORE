// src/lib/google/tokens.ts  (Task 5 portion — storeConnection + getValid* added in Tasks 6-7)
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from '@/lib/google/config';

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  return (await res.json()) as GoogleTokenResponse;
}

import { encryptToken } from '@/lib/google/crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoreConnectionArgs {
  userId: string;
  schoolId: string | null;
  googleId: string;
  email: string;
  tokens: GoogleTokenResponse;
}

export async function storeConnection(admin: SupabaseClient, args: StoreConnectionArgs): Promise<void> {
  const { tokens } = args;
  const row: Record<string, unknown> = {
    user_id: args.userId,
    school_id: args.schoolId,
    google_id: args.googleId,
    email: args.email,
    access_token_enc: encryptToken(tokens.access_token),
    token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    granted_scopes: tokens.scope ? tokens.scope.split(' ') : [],
    last_refresh_at: new Date().toISOString(),
  };
  // Omit refresh_token_enc on re-consent so the upsert's ON CONFLICT (user_id) DO UPDATE leaves the
  // saved refresh token intact (omission is load-bearing — never write refresh_token_enc: null).
  if (tokens.refresh_token) row.refresh_token_enc = encryptToken(tokens.refresh_token);
  const { error } = await admin.from('google_connections').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(`storeConnection failed: ${error.message}`);
}
