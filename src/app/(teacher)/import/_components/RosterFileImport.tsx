'use client';

/**
 * RosterFileImport — file-based roster upload for both admin (full) and teacher (lean) modes.
 *
 * full mode (school admins / platform_admin):
 *   - Download template link → GET /api/admin/roster/template
 *   - Preview: POST multipart to /api/admin/roster/import (mode=preview) →
 *       { mode:'preview', counts:{teachers,classes,students,enrollments,parents}, issues:string[] }
 *   - Commit: POST multipart to /api/admin/roster/import (mode=commit) →
 *       { mode:'commit', summary:{ teachers:{created,skipped,errors}, classes:{...}, students:{...},
 *         enrollments:{...}, parents:{created,linked,skipped,errors}, issues:string[] } }
 *
 * lean mode (teacher — scoped to one class):
 *   - Upload: POST multipart to /api/teacher/roster/import (file + classId) →
 *       { summary:{ studentsCreated, studentsExisting, enrolled, alreadyEnrolled, errors, issues } }
 *
 * A sub-selector (segmented control) lets the user pick between modes when both are available.
 * Token classes only; deep-ink text. Strings DRAFT → Barb (§ Import Roster).
 */
import React, { useRef, useState } from 'react';

export interface RosterFileImportProps {
  /** Whether the calling user can run a full (whole-school 5-sheet) import. */
  canFull?: boolean;
  /** Whether the calling user can run a lean (single-class) import — requires a valid classId. */
  canLean?: boolean;
  /** The resolved classId for lean mode; null if none available. */
  classId: string | null;
}

// ── Type shapes ──────────────────────────────────────────────────────────────

/** Lean (teacher) POST /api/teacher/roster/import response summary */
type LeanSummary = {
  studentsCreated?: number;
  studentsExisting?: number;
  enrolled?: number;
  alreadyEnrolled?: number;
  errors?: number;
  issues?: string[];
};

/** Full preview counts from POST /api/admin/roster/import (mode=preview) */
type FullPreviewCounts = {
  teachers?: number;
  classes?: number;
  students?: number;
  enrollments?: number;
  parents?: number;
};

/** Nested entity summary from POST /api/admin/roster/import (mode=commit) */
type EntitySummary = {
  created?: number;
  linked?: number;
  skipped?: number;
  errors?: number;
};

type FullCommitSummary = {
  teachers?: EntitySummary;
  classes?: EntitySummary;
  students?: EntitySummary;
  enrollments?: EntitySummary;
  parents?: EntitySummary;
  issues?: string[];
};

// ── Styles ───────────────────────────────────────────────────────────────────

const btnCls =
  'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';
const secondaryCls =
  'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';

// ── Entity label map for the commit summary (only the entity keys, not 'issues') ──
type EntityKey = 'teachers' | 'classes' | 'students' | 'enrollments' | 'parents';
const ENTITY_LABEL_ENTRIES: [EntityKey, string][] = [
  ['teachers', 'Teachers'],
  ['classes', 'Classes'],
  ['students', 'Students'],
  ['enrollments', 'Enrollments'],
  ['parents', 'Parents'],
];

export default function RosterFileImport({
  canFull = false,
  canLean = false,
  classId,
}: RosterFileImportProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  // Sub-selector: default to full when available, otherwise lean.
  const [subMode, setSubMode] = useState<'full' | 'lean'>(canFull ? 'full' : 'lean');

  // Shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // lean mode
  const [leanSummary, setLeanSummary] = useState<LeanSummary | null>(null);

  // full mode
  const [previewCounts, setPreviewCounts] = useState<FullPreviewCounts | null>(null);
  const [previewIssues, setPreviewIssues] = useState<string[]>([]);
  const [commitSummary, setCommitSummary] = useState<FullCommitSummary | null>(null);

  function resetState() {
    setError(null);
    setLeanSummary(null);
    setPreviewCounts(null);
    setPreviewIssues([]);
    setCommitSummary(null);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    resetState();
  }

  function onSubModeChange(next: 'full' | 'lean') {
    setSubMode(next);
    resetState();
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        // Reset file input so the user can import another file.
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
    setPreviewCounts(null);
    setPreviewIssues([]);
    setCommitSummary(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'preview');
      const res = await fetch('/api/admin/roster/import', { method: 'POST', body: fd });
      const data = await res.json() as {
        mode?: string;
        counts?: FullPreviewCounts;
        issues?: string[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong — please try again.');
      } else {
        setPreviewCounts(data.counts ?? {});
        setPreviewIssues(data.issues ?? []);
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
      const data = await res.json() as { mode?: string; summary?: FullCommitSummary; error?: string };
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

  const bothAvailable = canFull && canLean && !!classId;

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-selector: shown only when both modes are available */}
      {bothAvailable && (
        <div
          role="group"
          aria-label="Import scope"
          className="flex gap-2 flex-wrap"
        >
          {(
            [
              { value: 'full', label: 'Whole roster (5-sheet .xlsx)' },
              { value: 'lean', label: 'Just this class (.csv or .xlsx)' },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={subMode === value}
              onClick={() => onSubModeChange(value)}
              className={[
                'rounded-md border-2 px-4 py-2 font-display text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                subMode === value
                  ? 'border-sidebar-edge bg-brand text-fg-on-brand'
                  : 'border-sidebar-edge bg-surface text-fg',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Template download — full mode only */}
      {subMode === 'full' && (
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
          {subMode === 'lean' ? 'Uploading…' : previewCounts ? 'Committing…' : 'Previewing…'}
        </p>
      )}

      {/* lean mode: classId guard */}
      {subMode === 'lean' && !classId && (
        <p role="alert" className="text-sm text-fg">
          No class selected — open a class first.
        </p>
      )}

      {/* lean mode: Upload button + summary */}
      {subMode === 'lean' && !loading && !leanSummary && (
        <button
          type="button"
          disabled={!file || !classId}
          onClick={handleLeanUpload}
          className={btnCls}
        >
          Upload
        </button>
      )}
      {subMode === 'lean' && leanSummary && !loading && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
        >
          <p className="font-display text-base font-bold text-fg">Roster imported</p>
          <ul className="text-sm text-fg">
            {typeof leanSummary.studentsCreated === 'number' && (
              <li>{leanSummary.studentsCreated} new student{leanSummary.studentsCreated !== 1 ? 's' : ''} created</li>
            )}
            {typeof leanSummary.studentsExisting === 'number' && leanSummary.studentsExisting > 0 && (
              <li>{leanSummary.studentsExisting} already in CORE</li>
            )}
            {typeof leanSummary.enrolled === 'number' && (
              <li>{leanSummary.enrolled} enrolled</li>
            )}
            {typeof leanSummary.alreadyEnrolled === 'number' && leanSummary.alreadyEnrolled > 0 && (
              <li>{leanSummary.alreadyEnrolled} already enrolled</li>
            )}
            {typeof leanSummary.errors === 'number' && leanSummary.errors > 0 && (
              <li>{leanSummary.errors} could not be added</li>
            )}
          </ul>
          {leanSummary.issues && leanSummary.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-sm text-fg">
              {leanSummary.issues.map((issue, i) => (
                <li key={`${i}-${issue}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* full mode: Preview + Commit flow */}
      {subMode === 'full' && !loading && !previewCounts && !commitSummary && (
        <button
          type="button"
          disabled={!file}
          onClick={handleFullPreview}
          className={btnCls}
        >
          Preview
        </button>
      )}
      {subMode === 'full' && previewCounts && !loading && !commitSummary && (
        <div className="flex flex-col gap-3">
          <div
            role="status"
            className="rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
          >
            <p className="mb-2 font-display text-base font-bold text-fg">Preview</p>
            <p className="text-sm text-fg">
              {[
                typeof previewCounts.teachers === 'number' && `Teachers: ${previewCounts.teachers}`,
                typeof previewCounts.classes === 'number' && `Classes: ${previewCounts.classes}`,
                typeof previewCounts.students === 'number' && `Students: ${previewCounts.students}`,
                typeof previewCounts.enrollments === 'number' && `Enrollments: ${previewCounts.enrollments}`,
                typeof previewCounts.parents === 'number' && `Parents: ${previewCounts.parents}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {previewIssues.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-sm text-fg">
                {previewIssues.map((issue, i) => (
                  <li key={`${i}-${issue}`}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={handleFullCommit} className={btnCls}>
            Commit
          </button>
        </div>
      )}
      {subMode === 'full' && commitSummary && !loading && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
        >
          <p className="font-display text-base font-bold text-fg">Import complete</p>
          <div className="flex flex-col gap-1 text-sm text-fg">
            {ENTITY_LABEL_ENTRIES.map(([key, label]) => {
              const entity = commitSummary[key];
              if (!entity || typeof entity !== 'object') return null;
              const parts = [
                typeof entity.created === 'number' && `${entity.created} created`,
                typeof entity.linked === 'number' && entity.linked > 0 && `${entity.linked} linked`,
                typeof entity.skipped === 'number' && entity.skipped > 0 && `${entity.skipped} skipped`,
                typeof entity.errors === 'number' && entity.errors > 0 && `${entity.errors} errors`,
              ].filter(Boolean);
              if (parts.length === 0) return null;
              return (
                <p key={key}>
                  <span className="font-semibold">{label}:</span> {parts.join(' · ')}
                </p>
              );
            })}
          </div>
          {commitSummary.issues && commitSummary.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-sm text-fg">
              {commitSummary.issues.map((issue, i) => (
                <li key={`${i}-${issue}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
