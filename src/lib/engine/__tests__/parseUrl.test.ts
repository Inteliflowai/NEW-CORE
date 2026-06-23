import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractTextFromUrl, stripHtml, UrlFetchError } from '@/lib/engine/parseUrl';

describe('stripHtml', () => {
  it('removes scripts/styles/tags and decodes basic entities', () => {
    const html = '<style>x{}</style><script>bad()</script><h1>Hello&amp;</h1><p>World &lt;3</p>';
    const out = stripHtml(html);
    expect(out).toContain('Hello&');
    expect(out).toContain('World <3');
    expect(out).not.toMatch(/bad\(\)|x\{\}/);
  });
});

describe('extractTextFromUrl', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('rejects a non-URL', async () => {
    await expect(extractTextFromUrl('not a url')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('rejects non-http(s) protocols', async () => {
    await expect(extractTextFromUrl('ftp://example.com/x')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('rejects loopback/metadata hosts (SSRF baseline)', async () => {
    await expect(extractTextFromUrl('http://localhost/x')).rejects.toBeInstanceOf(UrlFetchError);
    await expect(extractTextFromUrl('http://127.0.0.1/x')).rejects.toBeInstanceOf(UrlFetchError);
    await expect(extractTextFromUrl('http://169.254.169.254/latest')).rejects.toBeInstanceOf(UrlFetchError);
    await expect(extractTextFromUrl('http://10.0.0.5/x')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('fetches + extracts text from a public URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body><h1>Photosynthesis</h1></body></html>', { status: 200 }),
    ) as unknown as typeof fetch;
    const text = await extractTextFromUrl('https://docs.google.com/document/d/abc/pub');
    expect(text).toContain('Photosynthesis');
  });
  it('throws UrlFetchError on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(extractTextFromUrl('https://example.com/missing')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('throws UrlFetchError when fetch itself rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    await expect(extractTextFromUrl('https://example.com/x')).rejects.toBeInstanceOf(UrlFetchError);
  });
});
