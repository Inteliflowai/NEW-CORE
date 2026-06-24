// POST — read text aloud (OpenAI TTS). Stateless: any authenticated user may have text read aloud,
// so getUser is the only gate. Returns audio/mpeg bytes streamed to an <audio> element; not stored.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resilientTextToSpeech } from '@/lib/ai/openai';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

const MAX_CHARS = 4096; // OpenAI TTS input limit

// Node runtime + a bounded hold so a stuck/retrying upstream request is reaped (cost surface).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { text?: string } | null;
    const text = body?.text?.trim();
    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });

    const audio = await resilientTextToSpeech(text.slice(0, MAX_CHARS));
    // Buffer is a Uint8Array at runtime but TS doesn't type it as BodyInit — wrap it.
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        // no-store: synthesized passage audio is cheap to regenerate; avoids a cached clip being
        // replayable by the next user on a shared/kiosk browser profile.
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[attempts/tts] error:', err);
    return respondEngineError(err);
  }
}
