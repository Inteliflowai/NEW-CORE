// src/app/api/admin/spark-enable/__tests__/route.test.ts
// Tests for POST /api/admin/spark-enable
// Node idiom — mirrors generate/__tests__/route.test.ts hoisted-mock pattern.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = { school_id: 'school-1' }): NextRequest {
  return new NextRequest('http://localhost/api/admin/spark-enable', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Supabase chain builder ───────────────────────────────────────────────────

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['insert'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['upsert'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

function makeAdminMock(opts: {
  school?: unknown;
  schoolError?: unknown;
  licenseData?: unknown;
} = {}) {
  const {
    school = { id: 'school-1', name: 'Demo School' },
    schoolError = null,
    licenseData = { feature_overrides: { existing_feature: true } },
  } = opts;

  const schoolChain = makeChain(school, schoolError);
  const licenseChain = makeChain(licenseData);
  const platformLinksChain = makeChain(null);
  const schoolLicensesUpdateChain = makeChain(null);

  // Intercept update on school_licenses
  licenseChain['update'] = vi.fn().mockReturnValue(schoolLicensesUpdateChain);
  schoolLicensesUpdateChain['eq'] = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    from: vi.fn((table: string) => {
      if (table === 'schools') return schoolChain;
      if (table === 'school_licenses') return licenseChain;
      if (table === 'platform_links') return platformLinksChain;
      return makeChain(null);
    }),
  };
}

// ─── module mocks (hoisted, top-level vi.mock — the RELIABLE pattern) ─────────

// Mock guardPlatformAdmin — returns null by default (allow), can be overridden per test
const mockGuardPlatformAdmin = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardPlatformAdmin: () => mockGuardPlatformAdmin(),
}));

// Mock the supabase server module
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

// Mock provisionSparkSchool
const mockProvisionSparkSchool = vi.fn();
vi.mock('@/lib/spark/provisionSparkSchool', () => ({
  provisionSparkSchool: (...a: unknown[]) => mockProvisionSparkSchool(...a),
}));

// Mock provisionSparkLink
const mockProvisionSparkLink = vi.fn();
vi.mock('@/lib/spark/sparkLink', () => ({
  provisionSparkLink: (...a: unknown[]) => mockProvisionSparkLink(...a),
  getSparkLink: vi.fn(),
  isSparkEnabled: vi.fn(),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/spark-enable', () => {
  beforeEach(() => {
    mockGuardPlatformAdmin.mockReset();
    mockProvisionSparkSchool.mockReset();
    mockProvisionSparkLink.mockReset();
    vi.resetModules();
  });

  // ── Guard rejection → guard response returned, no provisioning called ──────
  it('returns guard response (401) when not authenticated and does not provision', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardPlatformAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockProvisionSparkSchool).not.toHaveBeenCalled();
    expect(mockProvisionSparkLink).not.toHaveBeenCalled();
  });

  it('returns guard response (403) when role is insufficient and does not provision', async () => {
    const { NextResponse } = await import('next/server');
    mockGuardPlatformAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockProvisionSparkSchool).not.toHaveBeenCalled();
    expect(mockProvisionSparkLink).not.toHaveBeenCalled();
  });

  // ── 400 missing school_id ───────────────────────────────────────────────────
  it('returns 400 when school_id is missing', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/school_id/i);
    expect(mockProvisionSparkSchool).not.toHaveBeenCalled();
  });

  // ── 404 unknown school ──────────────────────────────────────────────────────
  it('returns 404 when school_id does not match any school', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({ school: null }) as never);

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest({ school_id: 'nonexistent' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/unknown/i);
    expect(mockProvisionSparkSchool).not.toHaveBeenCalled();
  });

  // ── 200 + steps when authed (happy path) ───────────────────────────────────
  it('returns 200 + steps when authed; calls provisionSparkSchool + provisionSparkLink + license update', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    const adminMock = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    mockProvisionSparkSchool.mockResolvedValue({ success: true, sparkSchoolId: 'spark-school-1' });
    mockProvisionSparkLink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest({ school_id: 'school-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.spark_school_id).toBe('spark-school-1');
    expect(body.steps).toBeDefined();
    expect(body.steps.spark).toMatch(/^ok/);
    expect(body.steps.link).toBe('ok');
    expect(body.steps.license).toBe('ok');

    // Assert both provision functions were called
    expect(mockProvisionSparkSchool).toHaveBeenCalledOnce();
    expect(mockProvisionSparkSchool).toHaveBeenCalledWith(expect.objectContaining({
      coreSchoolId: 'school-1',
      name: 'Demo School',
      coreBaseUrl: 'https://newcore.inteliflowai.com',
    }));

    expect(mockProvisionSparkLink).toHaveBeenCalledOnce();
    expect(mockProvisionSparkLink).toHaveBeenCalledWith(
      expect.anything(), // admin client
      expect.objectContaining({
        schoolId: 'school-1',
        coreBaseUrl: 'https://newcore.inteliflowai.com',
        label: 'SPARK',
      }),
    );
  });

  // ── license skipped when no license row ─────────────────────────────────────
  it('skips license update when there is no school_licenses row', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock({ licenseData: null }) as never);

    mockProvisionSparkSchool.mockResolvedValue({ success: true, sparkSchoolId: 'spark-school-1' });
    mockProvisionSparkLink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest({ school_id: 'school-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.steps.license).toMatch(/skipped/i);
  });

  // ── idempotent: second call also returns ok ─────────────────────────────────
  it('is idempotent: a second call with the same school_id also returns 200 ok', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    mockProvisionSparkSchool.mockResolvedValue({ success: true, sparkSchoolId: 'spark-school-1' });
    mockProvisionSparkLink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/admin/spark-enable/route');

    // First call
    const res1 = await POST(makeRequest({ school_id: 'school-1' }));
    expect(res1.status).toBe(200);

    // Second call (idempotency — same params)
    const res2 = await POST(makeRequest({ school_id: 'school-1' }));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.ok).toBe(true);
  });

  // ── SPARK failure does not block link + license ─────────────────────────────
  it('reports SPARK failure in steps but still processes link when SPARK call fails', async () => {
    mockGuardPlatformAdmin.mockResolvedValue(null);
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    mockProvisionSparkSchool.mockResolvedValue({ success: false, error: 'SPARK HTTP 503' });
    mockProvisionSparkLink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/admin/spark-enable/route');
    const res = await POST(makeRequest({ school_id: 'school-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    // ok should be false because SPARK call failed
    expect(body.ok).toBe(false);
    expect(body.steps.spark).toMatch(/failed/);
    // but link should still be attempted
    expect(mockProvisionSparkLink).toHaveBeenCalledOnce();
    expect(body.steps.link).toBe('ok');
  });
});
