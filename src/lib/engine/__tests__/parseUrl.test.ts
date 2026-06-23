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

  it('does NOT follow a 302 redirect to a blocked (metadata) host', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    ) as unknown as typeof fetch;
    await expect(extractTextFromUrl('https://example.com/r')).rejects.toBeInstanceOf(UrlFetchError);
  });

  it('follows a 302 redirect to an allowed host and returns its body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }))
      .mockResolvedValueOnce(new Response('<html><body><p>Redirected content</p></body></html>', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const text = await extractTextFromUrl('https://example.com/start');
    expect(text).toContain('Redirected content');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects numeric-IP encodings of loopback/metadata (decimal/hex/IPv4-mapped IPv6)', async () => {
    await expect(extractTextFromUrl('http://2130706433/x')).rejects.toBeInstanceOf(UrlFetchError); // 127.0.0.1 decimal
    await expect(extractTextFromUrl('http://0x7f000001/x')).rejects.toBeInstanceOf(UrlFetchError); // 127.0.0.1 hex
    await expect(extractTextFromUrl('http://[::ffff:169.254.169.254]/x')).rejects.toBeInstanceOf(UrlFetchError); // mapped metadata
  });

  it('throws UrlFetchError when more than 3 redirects are followed', async () => {
    // Every hop returns a 302 to a fresh allowed host → the cap (3) is exceeded.
    let n = 0;
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: `https://example.com/hop${++n}` } })),
    ) as unknown as typeof fetch;
    await expect(extractTextFromUrl('https://example.com/start')).rejects.toBeInstanceOf(UrlFetchError);
  });
});
