# GC Segment 5 — Google Drive Doc Import

> **Grounding:** inline (2026-06-26). The last Google Classroom segment.
> **Status:** spec for sign-off. After sign-off: `writing-plans` → SDD.

## Goal

Let a teacher import a Google Docs, Slides, or PDF file from their Google Drive directly into the Content Studio as a lesson — using their already-connected Google OAuth token — without having to share the file publicly first.

## Locked decisions (Marvin, 2026-06-26)

| # | Decision | Choice |
|---|---|---|
| D1 | UI placement | **Sub-option inside the existing "From a URL" tab** — no new 4th tab |
| D2 | File types | Google Docs + Slides (export to `text/plain`); PDF (download → existing `extractPdfText`); other types = best-effort text; binary-only types (images, video) = friendly error |
| D3 | Connection requirement | Teacher must have a Google connection (`google_connections` row); if missing → inline reconnect CTA linking to `/settings/google` |
| D4 | Scope | `drive.readonly` is already granted at connect; no forced reconnect; graceful reconnect prompt only on `GoogleNotConnectedError` |

## Architecture

```
Teacher pastes Drive URL
  → UrlImportStudio detects googleapis.com / docs.google.com → shows "Import from Google Drive" sub-path
  → POST /api/teacher/lessons/import-drive  {file_id, class_id}
      → requireRole(STAFF_ROLES)
      → guardClassAccess(class_id, userId)
      → getValidAccessTokenForTeacher(admin, userId)   — throws GoogleNotConnectedError if no token
      → extractTextFromGoogleDriveFile(fileId, accessToken, mimeType?)
             Google Docs/Slides: GET /drive/v3/files/{id}/export?mimeType=text/plain
             PDF:                GET /drive/v3/files/{id}?alt=media  → extractPdfText()
             Other text:         GET /drive/v3/files/{id}?alt=media  (text/*)
             Binary-only:        throw DriveUnsupportedTypeError
      → parseLesson(text)          — existing Seg-2 pipeline (LLM → ParsedLesson)
      → INSERT lessons { source: 'google_drive', ... }
      → return { lesson_id, parsed_content }
  → UrlImportStudio continues → LessonReviewEditor (existing Seg-2 review flow)
```

## File structure

- `src/lib/google/drive.ts` — NEW: `extractTextFromGoogleDriveFile(fileId, accessToken): Promise<string>` + `parseDriveUrl(url): string|null` (extracts file ID from `docs.google.com/*/d/{id}` and `drive.google.com/file/d/{id}` patterns)
- `src/app/api/teacher/lessons/import-drive/route.ts` — NEW: `POST /api/teacher/lessons/import-drive`
- `src/app/(teacher)/upload/_components/UrlImportStudio.tsx` — MODIFY: detect Drive URL → show Drive import UI branch
- `src/lib/google/errors.ts` — ADD: `DriveUnsupportedTypeError`

## No migration needed

`lessons.source` is a `text` column (not a constrained enum) — `'google_drive'` works as-is. Confirmed from migration 0019.

## Error states (user-facing, all strings → Barb)

| Condition | Message |
|---|---|
| Not connected to Google | "Connect your Google account to import Drive files" + link to `/settings/google` |
| File not shared with teacher | "This file isn't shared with your Google account" |
| File not found (404) | "We couldn't find that file in Google Drive" |
| Binary-only type | "This file type can't be imported as a lesson. Try exporting it as a PDF first." |
| Token expired (auto-refresh should handle; only if refresh also fails) | "Your Google connection needs to be refreshed" + reconnect link |
| Drive API error (non-auth) | "Google Drive is unavailable. Try again in a moment." |

## Drive URL detection logic

`parseDriveUrl(url)` matches and extracts the file ID from:
- `https://docs.google.com/document/d/{fileId}/edit`
- `https://docs.google.com/spreadsheets/d/{fileId}/edit`
- `https://docs.google.com/presentation/d/{fileId}/edit`
- `https://drive.google.com/file/d/{fileId}/view`
- `https://drive.google.com/open?id={fileId}`
- Direct API URL: `https://www.googleapis.com/drive/v3/files/{fileId}`

Returns `null` for non-Drive URLs → `UrlImportStudio` falls through to the existing generic URL path.

## UI flow in UrlImportStudio

```
URL input field
  └─ while typing, parseDriveUrl() runs client-side
       → if Drive URL detected:
            show "Google Drive file detected"  (icon + subtle callout)
            "Import" button calls /api/teacher/lessons/import-drive
       → if not a Drive URL:
            existing flow (calls /api/teacher/lessons/import-url as before)
```

No tab switch; no modal. The Drive branch is an inline swap of the import target inside the same URL tab.

## Security

- `drive.readonly` — teacher can only read files they have access to in their own Drive account. The API call is made on behalf of the teacher's own token, so they can never access files they don't already have permission to read.
- No new SSRF vectors: all calls go to `www.googleapis.com` (public IP). The existing `extractTextFromUrl` SSRF guard is bypassed in this path (we call Drive directly, not via `extractTextFromUrl`). The auth token is the access gate.
- File size: cap text extraction at 32 KB (same as the URL tab's 24 KB limit, bumped slightly for typical document prose). Truncate with a `console.warn` if over limit.

## Test plan

- `parseDriveUrl`: all 6 URL formats → correct file ID; non-Drive URL → null
- `extractTextFromGoogleDriveFile`: Docs export → text; PDF → extracted text; binary type → throws `DriveUnsupportedTypeError`
- Route: missing connection → 401 with reconnect signal; file-not-found → 404; success → lesson row with `source='google_drive'`
- `UrlImportStudio`: Drive URL detected → Drive import path triggered; non-Drive URL → existing path unchanged

## Gates

tsc 0 · vitest green · build 0 (a11y + tokens). No migration. Strings → `STRINGS-FOR-BARB.md §GC Seg 5`.
