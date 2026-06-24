// src/lib/google/profile.ts
export interface GoogleProfile { id: string; email: string; name?: string; verified_email?: boolean }

export async function getGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google userinfo failed: ${res.status}`);
  const j = (await res.json()) as GoogleProfile;
  return { id: j.id, email: j.email, name: j.name, verified_email: j.verified_email };
}
