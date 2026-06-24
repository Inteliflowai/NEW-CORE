import { describe, it, expect, vi, afterEach } from 'vitest';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function jsonRes(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('classroom adapter — listCourses', () => {
  it('loops nextPageToken and maps id/name/section/enrollmentCode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ courses: [{ id: 'c1', name: 'Math', section: 'A', enrollmentCode: 'abc' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(jsonRes({ courses: [{ id: 'c2', name: 'Sci' }] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { listCourses } = await import('@/lib/google/classroom');
    const out = await listCourses('AT');
    expect(out).toEqual([
      { id: 'c1', name: 'Math', section: 'A', enrollmentCode: 'abc' },
      { id: 'c2', name: 'Sci', section: null, enrollmentCode: null },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('teacherId=me');
    expect(String(fetchMock.mock.calls[0][0])).toContain('courseStates=ACTIVE');
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer AT' });
  });
  it('throws GoogleScopeError on a 403 insufficient-scope body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('ACCESS_TOKEN_SCOPE_INSUFFICIENT', { status: 403 })) as unknown as typeof fetch;
    const { listCourses, GoogleScopeError } = await import('@/lib/google/classroom');
    await expect(listCourses('AT')).rejects.toBeInstanceOf(GoogleScopeError);
  });
  it('throws a generic error (no body leak) on other non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('secret internal detail', { status: 500 })) as unknown as typeof fetch;
    const { listCourses } = await import('@/lib/google/classroom');
    await expect(listCourses('AT')).rejects.toThrow(/google courses list failed: 500/);
    await expect(listCourses('AT')).rejects.not.toThrow(/secret internal detail/);
  });
});

describe('classroom adapter — listCourseStudents', () => {
  it('loops nextPageToken, maps + lowercases email, and reports complete:true', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ students: [{ userId: 'g1', profile: { name: { fullName: 'Ann' }, emailAddress: 'ANN@b.EDU', photoUrl: 'u' } }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(jsonRes({ students: [{ userId: 'g2', profile: { name: { fullName: 'Bo' } } }] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out).toEqual({
      complete: true,
      students: [
        { googleId: 'g1', name: 'Ann', email: 'ann@b.edu', photoUrl: 'u' },
        { googleId: 'g2', name: 'Bo', email: '', photoUrl: null },
      ],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/courses/c1/students');
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
  });
  it('skips a roster record with a blank/missing userId (IMP-11)', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({ students: [
      { userId: 'g1', profile: { name: { fullName: 'Ann' }, emailAddress: 'a@b.edu' } },
      { userId: '', profile: { name: { fullName: 'Ghost' }, emailAddress: 'ghost@b.edu' } },
      { profile: { name: { fullName: 'NoId' }, emailAddress: 'noid@b.edu' } },
    ] })) as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out.students).toEqual([{ googleId: 'g1', name: 'Ann', email: 'a@b.edu', photoUrl: null }]);
    expect(out.complete).toBe(true);
  });
  it('reports complete:false when a non-first page is empty (no students key, no nextPageToken)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ students: [{ userId: 'g1', profile: { name: { fullName: 'Ann' }, emailAddress: 'a@b.edu' } }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(jsonRes({}));   // partial/transient: empty page terminates the loop
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out.students).toHaveLength(1);
    expect(out.complete).toBe(false);   // the engine must NOT soft-remove on this
  });
  it('a single empty first page is complete:true (a genuinely empty class is trustworthy)', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({})) as unknown as typeof fetch;
    const { listCourseStudents } = await import('@/lib/google/classroom');
    const out = await listCourseStudents('AT', 'c1');
    expect(out).toEqual({ students: [], complete: true });
  });
  it('throws GoogleScopeError on a 403 insufficient-scope body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('insufficient authentication scopes', { status: 403 })) as unknown as typeof fetch;
    const { listCourseStudents, GoogleScopeError } = await import('@/lib/google/classroom');
    await expect(listCourseStudents('AT', 'c1')).rejects.toBeInstanceOf(GoogleScopeError);
  });
});
