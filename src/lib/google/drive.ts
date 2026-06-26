// src/lib/google/drive.ts
// Google Drive text extraction for POST /api/teacher/lessons/import-drive.
//
// parseDriveUrl — client-safe (URL API only, no Node.js imports). Both
// UrlImportStudio ('use client') and the server route use this function.
//
// extractTextFromGoogleDriveFile — server-only (uses dynamic import('unpdf')).
// The client never calls this function, so the dynamic import never executes
// in the browser even though the module is imported client-side for parseDriveUrl.
import { DriveUnsupportedTypeError, DriveFileNotFoundError, DriveAccessDeniedError } from '@/lib/google/errors';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const MAX_TEXT_CHARS = 32_000;

// Google Workspace MIME types that support export to text/plain
const WORKSPACE_EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
]);

// Binary-only MIME prefixes — cannot be extracted as lesson text
const BINARY_PREFIXES = ['image/', 'video/', 'audio/'];
const BINARY_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

/**
 * Extract the Drive file ID from any of these URL forms:
 * - https://docs.google.com/document/d/{id}/edit
 * - https://docs.google.com/spreadsheets/d/{id}/edit
 * - https://docs.google.com/presentation/d/{id}/edit
 * - https://drive.google.com/file/d/{id}/view
 * - https://drive.google.com/open?id={id}
 * - https://www.googleapis.com/drive/v3/files/{id}
 *
 * Returns null for non-Drive URLs → UrlImportStudio falls through to existing /import-url path.
 */
export function parseDriveUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }

  if (u.hostname === 'docs.google.com') {
    const m = u.pathname.match(/\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/);
    return m ? m[1] : null;
  }
  if (u.hostname === 'drive.google.com') {
    const m = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (m) return m[1];
    return u.searchParams.get('id');
  }
  if (u.hostname === 'www.googleapis.com') {
    const m = u.pathname.match(/\/drive\/v3\/files\/([^/?]+)/);
    return m ? m[1] : null;
  }
  return null;
}

async function driveRequest(url: string, accessToken: string, label: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) throw new DriveFileNotFoundError();
  if (res.status === 403) throw new DriveAccessDeniedError();
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`); // status only — never leak body
  return res;
}

/**
 * Fetch plain text from a Drive file using the teacher's access token.
 *
 * Routing:
 * - Google Workspace Docs/Slides/Sheets → export as text/plain (Drive export endpoint)
 * - application/pdf → download binary → unpdf extraction
 * - text/* and unknown → download as text (best-effort)
 * - image/video/audio/zip/octet-stream → throw DriveUnsupportedTypeError
 *
 * Text is truncated to MAX_TEXT_CHARS (32 KB) with a console.warn if over limit.
 */
export async function extractTextFromGoogleDriveFile(
  fileId: string,
  accessToken: string,
): Promise<string> {
  // 1. Get file metadata to determine extraction path
  const metaRes = await driveRequest(
    `${DRIVE_BASE}/files/${fileId}?fields=mimeType%2Cname`,
    accessToken,
    'drive metadata',
  );
  const meta = (await metaRes.json()) as { mimeType: string; name: string };
  const { mimeType } = meta;

  // 2. Reject binary-only types before any download
  if (BINARY_PREFIXES.some((p) => mimeType.startsWith(p)) || BINARY_TYPES.has(mimeType)) {
    throw new DriveUnsupportedTypeError(mimeType);
  }

  // 3. Google Workspace native → export as text/plain
  if (WORKSPACE_EXPORTABLE.has(mimeType)) {
    const exportRes = await driveRequest(
      `${DRIVE_BASE}/files/${fileId}/export?mimeType=text%2Fplain`,
      accessToken,
      'drive export',
    );
    const text = await exportRes.text();
    if (text.length > MAX_TEXT_CHARS) {
      console.warn(`[gc/drive] ${fileId} export truncated from ${text.length} to ${MAX_TEXT_CHARS} chars`);
    }
    return text.slice(0, MAX_TEXT_CHARS);
  }

  // 4. PDF → download binary buffer → unpdf
  if (mimeType === 'application/pdf') {
    const dlRes = await driveRequest(
      `${DRIVE_BASE}/files/${fileId}?alt=media`,
      accessToken,
      'drive download pdf',
    );
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const { extractText } = await import('unpdf');
    const { text: pages } = await extractText(new Uint8Array(buffer));
    const combined = pages.join('\n\n');
    if (combined.length > MAX_TEXT_CHARS) {
      console.warn(`[gc/drive] pdf ${fileId} truncated from ${combined.length} to ${MAX_TEXT_CHARS} chars`);
    }
    return combined.slice(0, MAX_TEXT_CHARS);
  }

  // 5. text/* or anything else → download as text (best-effort)
  const dlRes = await driveRequest(
    `${DRIVE_BASE}/files/${fileId}?alt=media`,
    accessToken,
    'drive download',
  );
  const text = await dlRes.text();
  if (text.length > MAX_TEXT_CHARS) {
    console.warn(`[gc/drive] ${fileId} text truncated from ${text.length} to ${MAX_TEXT_CHARS} chars`);
  }
  return text.slice(0, MAX_TEXT_CHARS);
}
