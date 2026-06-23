// Import-safe. Fetch a public/link-shared URL (incl. published Google Docs) → plain text.
// The caller then runs the EXISTING parseLesson(). No next/server, no Supabase.
// Baseline SSRF guard: block loopback/private/metadata hosts. (DNS-rebinding / full SSRF
// hardening is deferred — documented in the plan.)

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 24_000;

export class UrlFetchError extends Error {}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
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

export async function extractTextFromUrl(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UrlFetchError("That doesn't look like a web address."); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlFetchError('Only http and https links are supported.');
  }
  if (isBlockedHost(url.hostname)) throw new UrlFetchError("We can't open that link.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CORE-ContentStudio/1.0; +https://inteliflowai.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch {
    throw new UrlFetchError("We couldn't reach that link.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new UrlFetchError("We couldn't open that link.");
  const html = await res.text();
  return stripHtml(html).slice(0, MAX_TEXT_CHARS);
}
