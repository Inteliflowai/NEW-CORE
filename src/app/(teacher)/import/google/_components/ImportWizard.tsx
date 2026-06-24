'use client';
// Google Classroom roster import wizard: select → REVIEW-ONLY preview → import → done.
// The preview is review-only (new / already-in-CORE / no-email tiles) — NOT a per-student pick-list.
// Every importable student is imported (the engine mirrors the full roster). Strings DRAFT → Barb.
import React, { useEffect, useState } from 'react';
import SyncNowButton from './SyncNowButton';

interface Course { id: string; name: string; section: string | null; enrollmentCode: string | null }
interface PreviewStudent { googleId: string; name: string; email: string; existsInCore: boolean }
// ImportResult is a discriminated union: the route returns either an error envelope or the real
// ReconcileResult shape. MIN-2: widening the type forces IMP-2 to branch explicitly.
// ITEM C (intentional pilot scope): the done-screen only shows the no-email skip bucket; the other
// skip buckets and errors are coach-posture noise — revisit with Barb before expanding.
type ImportResult =
  | { connected: false; needsReconnect?: boolean; error?: string }   // auth/reconnect envelope
  | { error: string; connected?: never }                              // 500 error envelope
  | { classId: string; created: number; linked: number; skippedNoEmail: number; reactivated: number; softRemoved: number };   // real result

const linkCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const btnCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export default function ImportWizard(): React.JSX.Element {
  const [step, setStep] = useState<'select' | 'preview' | 'importing' | 'done'>('select');
  const [courses, setCourses] = useState<Course[]>([]);
  const [reconnect, setReconnect] = useState(false);
  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<PreviewStudent[]>([]);
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [result, setResult] = useState<Extract<ImportResult, { classId: string }> | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/teacher/google/courses').then((r) => r.json()).then((d) => {
      if (!alive) return;
      if (d.connected === false || d.needsReconnect) { setReconnect(true); return; }
      setCourses(d.courses ?? []);
    }).catch(() => { if (alive) setReconnect(true); });
    return () => { alive = false; };
  }, []);

  async function pickCourse(c: Course) {
    setCourse(c); setSubject(''); setGrade('');
    const d = await fetch(`/api/teacher/google/roster?courseId=${encodeURIComponent(c.id)}`).then((r) => r.json());
    if (d.connected === false || d.needsReconnect) { setReconnect(true); return; }
    setStudents(d.students ?? []);
    setStep('preview');
  }

  async function doImport() {
    if (!course) return;
    setStep('importing');
    setImportError(null);
    const d: ImportResult = await fetch('/api/teacher/google/import-roster', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: course.id, name: course.name, subject, gradeLevel: grade }),
    }).then((r) => r.json());
    // IMP-2: branch before setStep('done'). Auth/reconnect → show reconnect CTA. Error envelope or
    // non-numeric counts (500 body) → show an error. Only a real ReconcileResult advances to 'done'.
    // Cast through unknown so the discriminated-union narrowing works correctly.
    const resp = d as unknown as Record<string, unknown>;
    if (resp['connected'] === false || resp['needsReconnect'] === true) {
      setReconnect(true);
      setStep('select');
      return;
    }
    if (typeof resp['created'] !== 'number') {
      setImportError('Something went wrong — please try again.');
      setStep('preview');
      return;
    }
    setResult(d as Extract<ImportResult, { classId: string }>);
    setStep('done');
  }

  if (reconnect) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker">
        <p role="status" className="text-fg text-sm">Connect Google Classroom to import a roster.</p>
        <a href="/api/teacher/google/connect" className={linkCls}>Connect Google Classroom</a>
      </div>
    );
  }

  const existing = students.filter((s) => s.email && s.existsInCore).length;
  const fresh = students.filter((s) => s.email && !s.existsInCore).length;
  const noEmail = students.filter((s) => !s.email).length;

  return (
    <div className="flex flex-col gap-4">
      {step === 'select' && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-extrabold text-fg">Choose a class to import</h2>
          {courses.map((c) => (
            <button key={c.id} type="button" onClick={() => pickCourse(c)} className={btnCls + ' justify-start'}>
              <span>{c.name}</span>{c.section ? <span className="ml-1 font-normal opacity-70"> · {c.section}</span> : null}
            </button>
          ))}
        </div>
      )}
      {step === 'preview' && course && (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-extrabold text-fg">Review {course.name}</h2>
          <label className="text-fg text-sm">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 block w-full rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2 text-fg" /></label>
          <label className="text-fg text-sm">Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} className="mt-1 block w-full rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2 text-fg" /></label>
          <ul className="text-fg text-sm">
            <li>{fresh} new</li>
            <li>{existing} already in CORE</li>
            <li>{noEmail} skipped — no email</li>
          </ul>
          {importError && <p role="alert" className="text-fg text-sm">{importError}</p>}
          <button type="button" onClick={doImport} className={linkCls}>Import roster</button>
        </div>
      )}
      {step === 'importing' && <p role="status" className="text-fg text-sm">Importing…</p>}
      {step === 'done' && result && (
        // ITEM C (intentional for the pilot): only the no-email skip is surfaced on the done screen.
        // The other skip buckets (ambiguous / rebind / duplicate / seat-cap) and `errors` are
        // deliberately NOT shown to the teacher — they are coach-posture noise for the pilot;
        // revisit with Barb before expanding this screen.
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-extrabold text-fg">Done</h2>
          <ul className="text-fg text-sm">
            <li>{result.created} created</li>
            <li>{result.linked} linked</li>
            <li>{result.skippedNoEmail} skipped — no email</li>
          </ul>
          <SyncNowButton classId={result.classId} />
        </div>
      )}
    </div>
  );
}
