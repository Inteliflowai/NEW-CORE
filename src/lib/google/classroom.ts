// src/lib/google/classroom.ts
// The single seam that touches classroom.googleapis.com (mirrors V1's google-classroom.ts).
// Zero-dep raw fetch, Bearer-authed with the teacher's valid access token (from the Seg-1
// token-manager). All reads loop nextPageToken (fixing V1's 50/100 caps). A 403 insufficient-scope
// maps to a typed GoogleScopeError so routes can surface the reconnect CTA; other failures throw a
// generic status-only error (never leak the Google response body).
const BASE = 'https://classroom.googleapis.com/v1';

export class GoogleScopeError extends Error {
  constructor() { super('google_scope_insufficient'); this.name = 'GoogleScopeError'; }
}

export interface GcCourse { id: string; name: string; section: string | null; enrollmentCode: string | null }
export interface GcStudent { googleId: string; name: string; email: string; photoUrl: string | null }
// The discriminated roster result: `complete=false` means the roster could not be trusted as the
// FULL current membership (a non-first page resolved with no `students` key AND no nextPageToken —
// a partial/transient result). The reconcile engine refuses to soft-remove on complete===false.
export interface GcRoster { students: GcStudent[]; complete: boolean }

async function gcGet(accessToken: string, url: string, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
      throw new GoogleScopeError();
    }
    throw new Error(`${label} failed: ${res.status}`); // status only — never leak the body
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function listCourses(accessToken: string): Promise<GcCourse[]> {
  const out: GcCourse[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ teacherId: 'me', courseStates: 'ACTIVE', pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gcGet(accessToken, `${BASE}/courses?${params.toString()}`, 'google courses list');
    for (const c of (data.courses as Array<Record<string, unknown>> | undefined) ?? []) {
      out.push({
        id: String(c.id),
        name: String(c.name ?? ''),
        section: (c.section as string | undefined) ?? null,
        enrollmentCode: (c.enrollmentCode as string | undefined) ?? null,
      });
    }
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return out;
}

// ── Write seam (POST/PATCH) — same Bearer + 403-scope + status-only-error contract as gcGet ──
async function gcWrite(accessToken: string, method: 'POST' | 'PATCH', url: string, body: unknown, label: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403 && /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) throw new GoogleScopeError();
    throw new Error(`${label} failed: ${res.status}`); // status only — never leak the body
  }
  // PATCH/empty responses may have no JSON body
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export interface CreateCourseWorkArgs { title: string; description?: string; linkUrl: string; maxPoints?: number | null }
export async function createCourseWork(accessToken: string, courseId: string, args: CreateCourseWorkArgs): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    title: args.title, workType: 'ASSIGNMENT', state: 'DRAFT',
    materials: [{ link: { url: args.linkUrl } }],
  };
  if (args.description) body.description = args.description;
  if (args.maxPoints != null) body.maxPoints = args.maxPoints;
  const data = await gcWrite(accessToken, 'POST', `${BASE}/courses/${courseId}/courseWork`, body, 'google courseWork create');
  if (!data.id) throw new Error('google courseWork create: no id returned'); // I3 — never String(undefined)
  return { id: String(data.id) };
}

export async function createCourseWorkMaterial(accessToken: string, courseId: string, args: { title: string; linkUrl: string }): Promise<{ id: string }> {
  const body = { title: args.title, state: 'PUBLISHED', materials: [{ link: { url: args.linkUrl } }] };
  const data = await gcWrite(accessToken, 'POST', `${BASE}/courses/${courseId}/courseWorkMaterials`, body, 'google courseWorkMaterial create');
  if (!data.id) throw new Error('google courseWorkMaterial create: no id returned'); // I3
  return { id: String(data.id) };
}

export interface GcSubmission { id: string; userId: string }
export async function listStudentSubmissions(accessToken: string, courseId: string, courseWorkId: string): Promise<GcSubmission[]> {
  const out: GcSubmission[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gcGet(accessToken, `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?${params.toString()}`, 'google submissions list');
    for (const s of (data.studentSubmissions as Array<Record<string, unknown>> | undefined) ?? []) {
      out.push({ id: String(s.id), userId: String(s.userId ?? '') });
    }
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return out;
}

export async function patchStudentSubmissionDraftGrade(accessToken: string, courseId: string, courseWorkId: string, submissionId: string, draftGrade: number): Promise<void> {
  await gcWrite(accessToken, 'PATCH',
    `${BASE}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}?updateMask=draftGrade`,
    { draftGrade }, 'google draftGrade patch');
}

export async function listCourseStudents(accessToken: string, courseId: string): Promise<GcRoster> {
  const out: GcStudent[] = [];
  let pageToken: string | undefined;
  let pageIndex = 0;
  let complete = true;   // becomes false if a NON-first page is empty with no nextPageToken
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gcGet(accessToken, `${BASE}/courses/${courseId}/students?${params.toString()}`, 'google students list');
    const students = data.students as Array<Record<string, unknown>> | undefined;
    const next = data.nextPageToken as string | undefined;
    // CRIT-2: a non-first page that returns no `students` key AND no nextPageToken is a partial/
    // transient result, NOT a true end-of-roster — mark the roster untrustworthy so the engine
    // refuses to soft-remove. (A single empty FIRST page = a genuinely empty class = trustworthy.)
    if (pageIndex > 0 && students === undefined && !next) complete = false;
    for (const s of students ?? []) {
      const googleId = String(s.userId ?? '');
      if (!googleId) continue;   // IMP-11: skip blank/missing userId (suspended/transitional account)
      const profile = (s.profile as Record<string, unknown> | undefined) ?? {};
      const nameObj = (profile.name as Record<string, unknown> | undefined) ?? {};
      const email = (profile.emailAddress as string | undefined) ?? '';
      out.push({
        googleId,
        name: String(nameObj.fullName ?? ''),
        email: email.toLowerCase(),
        photoUrl: (profile.photoUrl as string | undefined) ?? null,
      });
    }
    pageToken = next;
    pageIndex++;
  } while (pageToken);
  return { students: out, complete };
}
