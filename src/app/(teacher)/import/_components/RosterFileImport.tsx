'use client';

/**
 * RosterFileImport — file-based roster upload for both admin (full) and teacher (lean) modes.
 *
 * full mode (school admins / platform_admin):
 *   - Download template link → GET /api/admin/roster/template
 *   - Preview: POST multipart to /api/admin/roster/import (mode=preview) → per-sheet counts + issues
 *   - Commit: POST multipart to /api/admin/roster/import (mode=commit) → summary
 *
 * lean mode (teacher — scoped to one class):
 *   - Upload: POST multipart to /api/teacher/roster/import (file + classId) → summary
 *
 * Token classes only; deep-ink text. Strings DRAFT → Barb (§ Import Roster).
 */
import React, { useRef, useState } from 'react';

export interface RosterFileImportProps {
  mode: 'full' | 'lean';
  classId: string | null;
}

type LeanSummary = {
  studentsCreated?: number;
  enrolled?: number;
  skipped?: number;
  errors?: number;
  [key: string]: number | undefined;
};

type SheetResult = { rows: number; issues: string[] };
type PreviewResult = { sheets: Record<string, SheetResult> };

const btnCls =
  'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';
const secondaryCls =
  'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';

export default function RosterFileImport({ mode, classId }: RosterFileImportProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  // Shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // lean mode
  const [leanSummary, setLeanSummary] = useState<LeanSummary | null>(null);

  // full mode
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<LeanSummary | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    // Reset state when a new file is chosen
    setError(null);
    setLeanSummary(null);
    setPreview(null);
    setCommitSummary(null);
  }

  async function handleLeanUpload() {
    if (!file || !classId) return;
    setLoading(true);
    setError(null);
    setLeanSummary(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('classId', classId);
      const res = await fetch('/api/teacher/roster/import', { method: 'POST', body: fd });
      const data = await res.json() as { summary?: LeanSummary; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong — please try again.');
      } else {
        setLeanSummary(data.summary ?? {});
        // M-1: reset file input so the user can import another file
        if (fileInputRef.current) fileInputRef.current.value = '';
        setFile(null);
      }
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFullPreview() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    setCommitSummary(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'preview');
      const res = await fetch('/api/admin/roster/import', { method: 'POST', body: fd });
      const data = await res.json() as { sheets?: Record<string, SheetResult>; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong — please try again.');
      } else {
        setPreview({ sheets: data.sheets ?? {} });
      }
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFullCommit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setCommitSummary(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'commit');
      const res = await fetch('/api/admin/roster/import', { method: 'POST', body: fd });
      const data = await res.json() as { summary?: LeanSummary; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong — please try again.');
      } else {
        setCommitSummary(data.summary ?? {});
      }
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Template download — full mode only */}
      {mode === 'full' && (
        <a
          href="/api/admin/roster/template"
          download
          className={secondaryCls}
        >
          Download template
        </a>
      )}

      {/* File input */}
      <div className="flex flex-col gap-1">
        <label htmlFor="roster-file-input" className="text-sm font-semibold text-fg">
          Choose a file
          <span className="ml-1 font-normal text-fg-muted">(.xlsx or .csv)</span>
        </label>
        <input
          id="roster-file-input"
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={onFileChange}
          className="block w-full rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2 text-sm text-fg file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1 file:text-sm file:font-semibold file:text-fg-on-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        />
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="text-sm text-fg">
          {error}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <p role="status" className="text-sm text-fg">
          {mode === 'lean' ? 'Uploading…' : preview ? 'Committing…' : 'Previewing…'}
        </p>
      )}

      {/* lean mode: classId guard */}
      {mode === 'lean' && !classId && (
        <p role="alert" className="text-sm text-fg">
          No class selected — open a class first.
        </p>
      )}

      {/* lean mode: Upload button + summary */}
      {mode === 'lean' && !loading && !leanSummary && (
        <button
          type="button"
          disabled={!file || !classId}
          onClick={handleLeanUpload}
          className={btnCls}
        >
          Upload
        </button>
      )}
      {mode === 'lean' && leanSummary && !loading && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
        >
          <p className="font-display text-base font-bold text-fg">Roster imported</p>
          <ul className="text-sm text-fg">
            {typeof leanSummary.studentsCreated === 'number' && (
              <li>{leanSummary.studentsCreated} new student{leanSummary.studentsCreated !== 1 ? 's' : ''} created</li>
            )}
            {typeof leanSummary.enrolled === 'number' && (
              <li>{leanSummary.enrolled} enrolled</li>
            )}
            {typeof leanSummary.skipped === 'number' && leanSummary.skipped > 0 && (
              <li>{leanSummary.skipped} skipped</li>
            )}
            {typeof leanSummary.errors === 'number' && leanSummary.errors > 0 && (
              <li>{leanSummary.errors} could not be added</li>
            )}
          </ul>
        </div>
      )}

      {/* full mode: Preview + Commit flow */}
      {mode === 'full' && !loading && !preview && !commitSummary && (
        <button
          type="button"
          disabled={!file}
          onClick={handleFullPreview}
          className={btnCls}
        >
          Preview
        </button>
      )}
      {mode === 'full' && preview && !loading && !commitSummary && (
        <div className="flex flex-col gap-3">
          <div
            role="status"
            className="rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
          >
            <p className="mb-2 font-display text-base font-bold text-fg">Preview</p>
            {Object.entries(preview.sheets).map(([sheet, result]) => (
              <div key={sheet} className="mb-2">
                <p className="text-sm font-semibold text-fg">
                  {sheet}: {result.rows} row{result.rows !== 1 ? 's' : ''}
                </p>
                {result.issues.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-sm text-fg">
                    {result.issues.map((issue, i) => (
                      <li key={`${i}-${issue}`}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={handleFullCommit} className={btnCls}>
            Commit
          </button>
        </div>
      )}
      {mode === 'full' && commitSummary && !loading && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
        >
          <p className="font-display text-base font-bold text-fg">Import complete</p>
          <ul className="text-sm text-fg">
            {Object.entries(commitSummary).map(([key, value]) =>
              typeof value === 'number' ? (
                <li key={key}>
                  {value} {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                </li>
              ) : null
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
