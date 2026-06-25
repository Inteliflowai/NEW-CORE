import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCourseWork, createCourseWorkMaterial, listStudentSubmissions, patchStudentSubmissionDraftGrade, GoogleScopeError } from '@/lib/google/classroom';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('createCourseWork', () => {
  it('POSTs a DRAFT ASSIGNMENT courseWork with a link material + maxPoints, returns the id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'cw1' }));
    const r = await createCourseWork('tok', 'course1', { title: 'Quiz 1', linkUrl: 'https://core/x', maxPoints: 100 });
    expect(r.id).toBe('cw1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://classroom.googleapis.com/v1/courses/course1/courseWork');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ title: 'Quiz 1', workType: 'ASSIGNMENT', state: 'DRAFT', maxPoints: 100 });
    expect(body.materials[0].link.url).toBe('https://core/x');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
  // I3: a 200 with NO id must THROW (never store String(undefined) === 'undefined').
  it('throws when the response has no id (never stores "undefined")', async () => {
    fetchMock.mockResolvedValueOnce(ok({})); // empty body, no id
    await expect(createCourseWork('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toThrow(/no id/i);
  });
});

describe('createCourseWorkMaterial', () => {
  it('POSTs a PUBLISHED material with a link, returns the id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'mat1' }));
    const r = await createCourseWorkMaterial('tok', 'c1', { title: 'Open in CORE', linkUrl: 'https://core/' });
    expect(r.id).toBe('mat1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://classroom.googleapis.com/v1/courses/c1/courseWorkMaterials');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ title: 'Open in CORE', state: 'PUBLISHED' });
    expect(body.materials[0].link.url).toBe('https://core/');
  });
  it('throws when the response has no id (I3)', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await expect(createCourseWorkMaterial('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toThrow(/no id/i);
  });
});

describe('patchStudentSubmissionDraftGrade', () => {
  it('PATCHes draftGrade ONLY (no assignedGrade, no :return)', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await patchStudentSubmissionDraftGrade('tok', 'c1', 'cw1', 'sub1', 88);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://classroom.googleapis.com/v1/courses/c1/courseWork/cw1/studentSubmissions/sub1?updateMask=draftGrade');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ draftGrade: 88 }); // draftGrade ONLY
    expect(url).not.toContain(':return');
  });
});

describe('listStudentSubmissions', () => {
  // M7: assert the wire — path, pageSize=100, and the 2nd call's pageToken.
  it('paginates (pageSize=100, carries pageToken) and returns {id,userId}', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ studentSubmissions: [{ id: 's1', userId: 'u1' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(ok({ studentSubmissions: [{ id: 's2', userId: 'u2' }] }));
    const r = await listStudentSubmissions('tok', 'c1', 'cw1');
    expect(r).toEqual([{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }]);
    const url1 = fetchMock.mock.calls[0][0] as string;
    expect(url1).toContain('/courses/c1/courseWork/cw1/studentSubmissions');
    expect(url1).toContain('pageSize=100');
    expect(url1).not.toContain('pageToken');
    const url2 = fetchMock.mock.calls[1][0] as string;
    expect(url2).toContain('pageToken=p2');
  });
  // C4 path: an empty list (DRAFT courseWork with no submissions) returns [] without throwing.
  it('returns [] when the courseWork has no submissions yet (DRAFT)', async () => {
    fetchMock.mockResolvedValueOnce(ok({})); // no studentSubmissions key
    const r = await listStudentSubmissions('tok', 'c1', 'cw1');
    expect(r).toEqual([]);
  });
});

describe('write scope error', () => {
  it('maps a 403 insufficient-scope to GoogleScopeError', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' });
    await expect(createCourseWork('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toBeInstanceOf(GoogleScopeError);
  });
  it('throws a status-only error on other failures (no body leak)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'secret google internals' });
    await expect(createCourseWorkMaterial('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.toThrow(/failed: 500/);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'secret google internals' });
    await expect(createCourseWorkMaterial('tok', 'c1', { title: 't', linkUrl: 'u' })).rejects.not.toThrow(/secret/);
  });
});
