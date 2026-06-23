// Import-safe. Fetch a public/link-shared URL (incl. published Google Docs) → plain text.
// The caller then runs the EXISTING parseLesson(). No next/server, no Supabase.
// Baseline SSRF guard: block loopback/private/metadata hosts. (DNS-rebinding / full SSRF
// hardening is deferred — documented in the plan.)

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 24_000;
const MAX_REDIRECTS = 3;

export class UrlFetchError extends Error {}

// Range checks on a dotted-quad IPv4 string (private/loopback/link-local/metadata/unspecified).
function isBlockedIpv4(quad: string): boolean {
  const parts = quad.split('.');
  if (parts.length !== 4) return false;
  const octs = parts.map((p) => Number(p));
  if (octs.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octs;
  if (a === 0) return true;                       // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 127) return true;                     // 127.0.0.0/8 loopback
  if (a === 10) return true;                      // 10.0.0.0/8 private
  if (a === 192 && b === 168) return true;        // 192.168.0.0/16 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 169 && b === 254) return true;        // 169.254.0.0/16 link-local (incl. metadata)
  return false;
}

// Canonicalize a host that is some numeric IPv4 encoding (decimal / hex / octal / dotted)
// to a dotted-quad string, or return null if it is not a recognizable numeric IPv4 form.
function numericHostToDottedQuad(h: string): string | null {
  // Already dotted (possibly with non-decimal octets) — normalize each octet.
  if (h.includes('.')) {
    const parts = h.split('.');
    if (parts.length !== 4) return null;
    const octs: number[] = [];
    for (const part of parts) {
      let n: number;
      if (/^0x[0-9a-f]+$/i.test(part)) n = parseInt(part, 16);
      else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
      else if (/^[0-9]+$/.test(part)) n = parseInt(part, 10);
      else return null;
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      octs.push(n);
    }
    return octs.join('.');
  }
  // A single integer (decimal / hex / octal) interpreted as a 32-bit IPv4 address.
  let value: number | null = null;
  if (/^0x[0-9a-f]+$/i.test(h)) value = parseInt(h, 16);
  else if (/^0[0-7]+$/.test(h)) value = parseInt(h, 8);
  else if (/^[0-9]+$/.test(h)) value = parseInt(h, 10);
  if (value === null || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 / ::ffff:169.254.169.254) → strip the prefix, apply v4 checks.
  if (h.startsWith('::ffff:')) {
    const tail = h.slice('::ffff:'.length);
    const quad = numericHostToDottedQuad(tail);
    if (quad && isBlockedIpv4(quad)) return true;
    if (isBlockedIpv4(tail)) return true;
  }

  // Canonicalize any numeric IPv4 encoding (decimal 2130706433, hex 0x7f000001, octal
  // 017700000001, non-canonical dotted) before the range checks.
  const quad = numericHostToDottedQuad(h);
  if (quad && isBlockedIpv4(quad)) return true;

  // Literal checks retained for belt-and-suspenders.
  if (h === '0.0.0.0' || h === '169.254.169.254' || h.startsWith('127.')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlFetchError('Only http and https links are supported.');
  }
  if (isBlockedHost(url.hostname)) throw new UrlFetchError("We can't open that link.");
}

export async function extractTextFromUrl(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UrlFetchError("That doesn't look like a web address."); }
  validateUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    // Manual redirect loop: re-validate the protocol + host of EVERY hop before fetching it,
    // so a 30x to a blocked host (e.g. the cloud metadata endpoint) can never be followed.
    let current = url;
    let redirectsLeft = MAX_REDIRECTS;
    for (;;) {
      res = await fetch(current.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CORE-ContentStudio/1.0; +https://inteliflowai.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (res.status < 300 || res.status > 399) break; // not a redirect — done
      const location = res.headers.get('location');
      if (!location) break; // redirect with no target — treat as terminal response
      if (redirectsLeft <= 0) throw new UrlFetchError('Too many redirects.');
      redirectsLeft -= 1;
      let next: URL;
      try { next = new URL(location, current); } catch { throw new UrlFetchError("We couldn't open that link."); }
      validateUrl(next);
      current = next;
    }
  } catch (err) {
    if (err instanceof UrlFetchError) throw err;
    throw new UrlFetchError("We couldn't reach that link.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new UrlFetchError("We couldn't open that link.");
  const html = await res.text();
  return stripHtml(html).slice(0, MAX_TEXT_CHARS);
}
