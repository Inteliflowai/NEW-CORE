// Signed launch-state for the PUBLIC Open-CORE silent-SSO link (GC Seg 4). Zero-dep HMAC-SHA256
// (mirrors signLaunchJwt.ts). The state rides in the OAuth `state` param, so it carries NO
// identity — only the destination (gc/id), a one-time nonce (matched against an httpOnly cookie),
// a mode (silent vs interactive), and a 10-min expiry. Identity is established ONLY by Google's
// verified profile in the callback.
import { createHmac, timingSafeEqual } from 'crypto';

export const LAUNCH_STATE_PREFIX = 'launch:';
export const LAUNCH_TTL_SECONDS = 600; // 10 minutes

// The one-time nonce cookie name. The __Host- prefix (production) forbids a Domain attribute, so a
// sibling *.inteliflowai.com app cannot set or shadow it (M1); plain name on local http where the
// __Host- mandatory-Secure flag can't be honored. NODE_ENV is read once at module load.
export const NONCE_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-g_launch_nonce' : 'g_launch_nonce';

export type LaunchGc = 'quiz' | 'assignment';
export type LaunchMode = 'silent' | 'interactive';

export interface LaunchPayload {
  gc: LaunchGc;
  id: string;
  nonce: string;
  mode: LaunchMode;
  exp: number; // epoch SECONDS
}

class LaunchSecretMissingError extends Error {
  constructor() { super('GOOGLE_LAUNCH_STATE_SECRET not set'); this.name = 'LaunchSecretMissingError'; }
}
function getSecret(): string {
  const s = (process.env.GOOGLE_LAUNCH_STATE_SECRET || '').trim();
  if (!s) throw new LaunchSecretMissingError();
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/** Sign a launch state. `nowSeconds`/`ttlSeconds` are injectable for tests. Throws if the secret
 *  is unset (the initiator catches and falls back to /login). */
export function signLaunchState(
  input: { gc: LaunchGc; id: string; nonce: string; mode: LaunchMode },
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = LAUNCH_TTL_SECONDS,
): string {
  const payload: LaunchPayload = { ...input, exp: nowSeconds + ttlSeconds };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${LAUNCH_STATE_PREFIX}${body}.${sig}`;
}

/** Verify + parse a launch state. Returns null on ANY failure (fail-closed): bad prefix, missing
 *  secret, tampered/length-mismatched signature, malformed payload, expired, or invalid fields. */
export function verifyLaunchState(
  state: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): LaunchPayload | null {
  if (!state || !state.startsWith(LAUNCH_STATE_PREFIX)) return null;
  const rest = state.slice(LAUNCH_STATE_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  let expected: string;
  try { expected = createHmac('sha256', getSecret()).update(body).digest('base64url'); }
  catch { return null; } // secret missing → fail-closed

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: LaunchPayload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LaunchPayload; }
  catch { return null; }

  if (payload.gc !== 'quiz' && payload.gc !== 'assignment') return null;
  if (typeof payload.id !== 'string' || payload.id.length === 0) return null;
  if (typeof payload.nonce !== 'string' || payload.nonce.length === 0) return null;
  if (payload.mode !== 'silent' && payload.mode !== 'interactive') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  return payload;
}

/** Allow-list a final redirect destination to internal /student paths only. Rejects
 *  protocol-relative (//), scheme (://), backslash, and CRLF. Returns /student/dashboard for
 *  anything not an allowed /student path. */
export function safeStudentDest(path: string): string {
  const FALLBACK = '/student/dashboard';
  if (typeof path !== 'string') return FALLBACK;
  if (path.startsWith('//')) return FALLBACK;
  if (path.includes('://') || path.includes('\\') || path.includes('\n') || path.includes('\r')) return FALLBACK;
  if (path.includes('/../') || path.endsWith('/..')) return FALLBACK; // forward-slash traversal (m4)
  if (path !== '/student' && !path.startsWith('/student/') && !path.startsWith('/student?')) return FALLBACK;
  return path;
}
