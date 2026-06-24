// src/lib/google/config.ts
// Google Classroom integration config. Mirrors the repo env idiom (src/lib/spark/config.ts):
// read process.env at module top-level with a default. GOOGLE_TOKEN_ENC_KEY is read at call-time
// inside crypto.ts (so tests can set it per-case), NOT here.
export const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
export const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
export const GOOGLE_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').trim();

const GC = 'https://www.googleapis.com/auth';

// Requested at connect (7) — incl. drive.readonly (Drive import is in epic scope).
export const GC_SCOPES: string[] = [
  'openid', 'email', 'profile',
  `${GC}/classroom.courses.readonly`,
  `${GC}/classroom.rosters.readonly`,
  `${GC}/classroom.profile.emails`,
  `${GC}/classroom.coursework.students`,
  `${GC}/classroom.courseworkmaterials`,
  `${GC}/drive.readonly`,
];

// The reconnect-check set: the write + roster scopes CORE actually requires to function.
// Omits the login triplet (openid/email/profile) and drive.readonly (import is best-effort).
export const GC_REQUIRED_SCOPES: string[] = [
  `${GC}/classroom.courses.readonly`,
  `${GC}/classroom.rosters.readonly`,
  `${GC}/classroom.profile.emails`,
  `${GC}/classroom.coursework.students`,
  `${GC}/classroom.courseworkmaterials`,
];
