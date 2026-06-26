import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDriveUrl, extractTextFromGoogleDriveFile } from '../drive';
import { DriveUnsupportedTypeError, DriveFileNotFoundError, DriveAccessDeniedError } from '../errors';

vi.mock('unpdf', () => ({
  extractText: vi.fn().mockResolvedValue({ text: ['PDF page one', 'PDF page two'] }),
}));

const TOKEN = 'fake-access-token';
const FILE_ID = 'file123';

function metaRes(mimeType: string, status = 200) {
  return new Response(JSON.stringify({ mimeType, name: 'Test File' }), { status });
}

beforeEach(() => { vi.restoreAllMocks(); });

// ── parseDriveUrl ──────────────────────────────────────────────────────────────

describe('parseDriveUrl', () => {
  it.each([
    ['Docs edit URL',        'https://docs.google.com/document/d/DOC_ID/edit',         'DOC_ID'],
    ['Sheets edit URL',      'https://docs.google.com/spreadsheets/d/SHEET_ID/edit',   'SHEET_ID'],
    ['Slides edit URL',      'https://docs.google.com/presentation/d/SLIDE_ID/edit',   'SLIDE_ID'],
    ['Drive file/d/ URL',    'https://drive.google.com/file/d/DRIVE_ID/view',          'DRIVE_ID'],
    ['Drive open?id= URL',   'https://drive.google.com/open?id=OPEN_ID',               'OPEN_ID'],
    ['googleapis.com URL',   'https://www.googleapis.com/drive/v3/files/API_ID',       'API_ID'],
  ])('extracts file ID from %s', (_label, url, expected) => {
    expect(parseDriveUrl(url)).toBe(expected);
  });

  it.each([
    'https://example.com/file.pdf',
    'not-a-url',
    'https://docs.google.com/',
    'https://docs.google.com/forms/d/FORM_ID/edit',  // forms — no path match
  ])('returns null for non-Drive URL: %s', (url) => {
    expect(parseDriveUrl(url)).toBeNull();
  });
});

// ── extractTextFromGoogleDriveFile ─────────────────────────────────────────────

describe('extractTextFromGoogleDriveFile', () => {
  it('exports text from a Google Docs file via the export endpoint', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/vnd.google-apps.document'))
      .mockResolvedValueOnce(new Response('Document text content', { status: 200 })) as typeof fetch;

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result).toBe('Document text content');
  });

  it('exports text from a Google Slides file via the export endpoint', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/vnd.google-apps.presentation'))
      .mockResolvedValueOnce(new Response('Slide text content', { status: 200 })) as typeof fetch;

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result).toBe('Slide text content');
  });

  it('extracts text from a PDF via unpdf', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/pdf'))
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), { status: 200 })) as typeof fetch;

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result).toBe('PDF page one\n\nPDF page two');
  });

  it('throws DriveUnsupportedTypeError for image/png', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('image/png')) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveUnsupportedTypeError);
  });

  it('throws DriveUnsupportedTypeError for video/mp4', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('video/mp4')) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveUnsupportedTypeError);
  });

  it('throws DriveFileNotFoundError when Drive returns 404', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 })) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveFileNotFoundError);
  });

  it('throws DriveAccessDeniedError when Drive returns 403', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 })) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveAccessDeniedError);
  });

  it('truncates export text to 32000 chars and emits console.warn', async () => {
    const longText = 'x'.repeat(40_000);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/vnd.google-apps.document'))
      .mockResolvedValueOnce(new Response(longText, { status: 200 })) as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result.length).toBe(32_000);
    expect(warnSpy).toHaveBeenCalled();
  });
});
