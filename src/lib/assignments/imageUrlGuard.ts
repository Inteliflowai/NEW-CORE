// src/lib/assignments/imageUrlGuard.ts
// Validates the image_url a student persists into responses.tasks[step].image_url.
//
// THREAT: a student fully controls the request body. The only legitimate value for
// image_url is a proxy link THIS app minted from POST /api/attempts/drawing — i.e.
// `/api/attempts/drawing?path=<owned-path>` where the path's first segment is the
// caller's own user id. A teacher's browser later renders this via <img src>, so an
// arbitrary/external URL (or another student's path) must never be persisted.
//
// Pure helpers (no I/O) so both the draft + submit write boundaries can call them.

const PROXY_RE = /^\/api\/attempts\/drawing\?path=.+/;

/** True iff `url` is a string shaped like our drawing-proxy link. Does NOT check ownership. */
export function isProxyImageUrl(url: unknown): url is string {
  return typeof url === 'string' && PROXY_RE.test(url);
}

/**
 * True iff `url` is an acceptable image reference for `userId`:
 *  - null / undefined → true (no image is fine)
 *  - otherwise it MUST be a proxy URL, the decoded path MUST NOT contain '..'
 *    (traversal), AND the path's owner segment (`path.split('/')[0]`) MUST equal `userId`.
 *  - any non-string → false.
 */
export function isOwnedProxyImageUrl(url: unknown, userId: string): boolean {
  if (url === null || url === undefined) return true;
  if (!isProxyImageUrl(url)) return false;
  const rawPath = url.slice('/api/attempts/drawing?path='.length);
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { return false; }
  if (path.includes('..')) return false;
  return path.split('/')[0] === userId;
}

type ResponsesLike = { tasks?: Record<string, { image_url?: unknown } | null | undefined> } | null | undefined;

/** True iff EVERY responses.tasks[*].image_url passes isOwnedProxyImageUrl for `userId`. */
export function responsesImageUrlsOk(responses: ResponsesLike, userId: string): boolean {
  const tasks = responses?.tasks;
  if (!tasks || typeof tasks !== 'object') return true;
  for (const task of Object.values(tasks)) {
    if (!isOwnedProxyImageUrl(task?.image_url, userId)) return false;
  }
  return true;
}
