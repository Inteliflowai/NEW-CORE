import { NextResponse } from 'next/server';
// P1 stub — body is a later-plan deliverable. Created up front to dodge the
// Turbopack new-top-level-api-folder 404 trap (spec §1.5).
export async function POST() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
