// POST — transcribe a short voice recording to text (OpenAI Whisper). Stateless: any authenticated
// user may transcribe their OWN audio (no object access), so getUser is the only gate. Audio is
// transient — NOT stored. The transcript flows back to the caller, who appends it to a field.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resilientAudioTranscription } from '@/lib/ai/openai';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI Whisper hard limit
const MIN_BYTES = 1024;             // below this it is too short to be speech

// Buffer/toFile need the Node runtime; cap the held connection so a stuck/retrying
// upstream request is reaped rather than pinning a function (bounds the cost surface).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    const file = form.get('file');
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'Missing audio' }, { status: 400 });
    // Require an audio/* content-type — an empty/missing type must NOT bypass the guard.
    if (!file.type || !file.type.startsWith('audio/')) return NextResponse.json({ error: 'Only audio is supported.' }, { status: 415 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That recording is too long.' }, { status: 413 });
    if (file.size < MIN_BYTES) return NextResponse.json({ error: 'too_short' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.type.includes('mp4') ? 'audio.mp4' : 'audio.webm';
    const transcript = await resilientAudioTranscription({ buffer, filename });
    return NextResponse.json({ transcript: transcript.trim() });
  } catch (err) {
    console.error('[attempts/transcribe] error:', err);
    return respondEngineError(err);
  }
}
