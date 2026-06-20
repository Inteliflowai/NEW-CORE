// src/app/api/cron/idempotency-sweep/route.ts
// Daily sweep (vercel.json: 0 3 * * *) — delete expired webhook_idempotency_keys.
// CRON_SECRET gate matches the existing weekly-snapshot cron pattern.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const sweptAt = new Date().toISOString();
  const { data, error } = await admin
    .from('webhook_idempotency_keys')
    .delete()
    .lt('expires_at', sweptAt)
    .not('expires_at', 'is', null)
    .select('id');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message, swept_at: sweptAt }, { status: 200 });
  }
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0, swept_at: sweptAt });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
