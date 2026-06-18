// src/lib/engine/__tests__/assignmentGen.test.ts
// Tests for generateAssignment (engine call #5, Claude→GPT) + inferLearningStyle (#5a)
//
// Mandatory cases (task-8-corrections.md):
//   C1 throw-paths: Claude throws → GPT fallback; both throw → LlmExhaustedError
//   C1 inferLearningStyle: throws → emerging (degrade, never rethrow)
//   Null-path cases kept alongside throw-paths per spec.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

// ── module-level mocks (hoisted, so modules resolve before any import) ──────
const mockClaude = vi.fn();
const mockOpenAI = vi.fn();

vi.mock('@/lib/ai/claude', () => ({
  claudeChat: (...a: unknown[]) => mockClaude(...a),
}));
vi.mock('@/lib/ai/openai', () => ({
  resilientChatCompletion: (...a: unknown[]) => mockOpenAI(...a),
}));

// ── fixture: a fully valid Assignment JSON string ────────────────────────────
const ASSIGNMENT_OBJ = {
  title: 'Reteach: Fractions',
  mode: 'scaffolded',
  learning_style: 'visual',
  reading_passage: '**Fractions** are parts of a whole. A fraction has a numerator and a denominator.',
  audio_script: 'Fractions are parts of a whole.',
  diagram_mode: 'image' as const,
  diagram_description: 'a pizza cut into parts',
  diagram_svg_prompt: 'label the slices',
  diagram_image_prompt: 'a pizza sliced into eighths, no text',
  youtube_search_query: 'fractions for grade 4',
  instructions: 'Do these tasks.',
  tasks: [
    {
      step: 1,
      description: 'Draw and label a fraction',
      type: 'draw' as const,
      strategy: 'Idea Mapping',
      atl_skill: 'Thinking',
      ib_attribute: 'Thinkers',
      bloom_level: 'Understand',
    },
    {
      step: 2,
      description: 'Color-code halves and quarters',
      type: 'draw' as const,
      strategy: 'Quick Look',
      atl_skill: 'Research',
      ib_attribute: 'Inquirers',
      bloom_level: 'Remember',
    },
  ],
  support_note: 'You can do this!',
  atl_summary: ['Thinking'],
  ib_attributes: ['Thinkers'],
};
const ASSIGNMENT = JSON.stringify(ASSIGNMENT_OBJ);

// GPT-style wrapper response
function gptResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

// ── generateAssignment ────────────────────────────────────────────────────────

describe('generateAssignment', () => {
  beforeEach(() => {
    mockClaude.mockReset();
    mockOpenAI.mockReset();
    vi.resetModules();
  });

  it('band+style flow into the prompt; Claude primary succeeds', async () => {
    mockClaude.mockResolvedValue(ASSIGNMENT);
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    const out = await generateAssignment({
      lessonSummary: 'Fractions intro',
      band: 'reteach',
      style: 'visual',
      studentName: 'Sam',
    });
    expect(out.title).toContain('Fractions');
    // Confirm band+style appear in the user-message sent to Claude
    const userMsg = mockClaude.mock.calls[0][1] as string;
    expect(userMsg.toUpperCase()).toContain('RETEACH');
    expect(userMsg.toUpperCase()).toContain('VISUAL');
    // GPT must NOT have been called
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it('Claude null → falls back to GPT (null-path C1)', async () => {
    mockClaude.mockResolvedValue(null);
    mockOpenAI.mockResolvedValue(gptResponse(ASSIGNMENT));
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    const out = await generateAssignment({
      lessonSummary: 'Fractions intro',
      band: 'reteach',
      style: 'visual',
      studentName: 'Sam',
    });
    expect(out.mode).toBe('scaffolded');
    expect(mockOpenAI).toHaveBeenCalledOnce();
  });

  it('Claude throws LlmExhaustedError → falls back to GPT (C1 throw-path)', async () => {
    mockClaude.mockRejectedValue(new LlmExhaustedError('claude'));
    mockOpenAI.mockResolvedValue(gptResponse(ASSIGNMENT));
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    const out = await generateAssignment({
      lessonSummary: 'Fractions intro',
      band: 'reteach',
      style: 'visual',
      studentName: 'Sam',
    });
    expect(out.mode).toBe('scaffolded');
    expect(mockOpenAI).toHaveBeenCalledOnce();
  });

  it('both legs return null → throws LlmExhaustedError', async () => {
    mockClaude.mockResolvedValue(null);
    mockOpenAI.mockResolvedValue(null);
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    await expect(
      generateAssignment({ lessonSummary: 'x', band: 'reteach', style: 'visual', studentName: 'Sam' }),
    ).rejects.toMatchObject({ name: 'LlmExhaustedError' });
  });

  it('both legs throw LlmExhaustedError → throws LlmExhaustedError (C1 throw-path)', async () => {
    mockClaude.mockRejectedValue(new LlmExhaustedError('claude'));
    mockOpenAI.mockRejectedValue(new LlmExhaustedError('openai'));
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    await expect(
      generateAssignment({ lessonSummary: 'x', band: 'reteach', style: 'visual', studentName: 'Sam' }),
    ).rejects.toMatchObject({ name: 'LlmExhaustedError' });
    // band-mismatch never silently substituted: GPT was attempted (as fallback)
    expect(mockOpenAI).toHaveBeenCalledOnce();
  });
});

// ── inferLearningStyle (#5a) ──────────────────────────────────────────────────

describe('inferLearningStyle (#5a)', () => {
  beforeEach(() => {
    mockOpenAI.mockReset();
    vi.resetModules();
  });

  it('null completion → emerging, confidence 0 (never fabricated)', async () => {
    mockOpenAI.mockResolvedValue(null);
    const { inferLearningStyle } = await import('@/lib/engine/assignmentGen');
    const s = await inferLearningStyle('some behavioral signals');
    expect(s.learning_style).toBe('emerging');
    expect(s.confidence).toBe(0);
  });

  it('GPT returns valid style → returns parsed result', async () => {
    mockOpenAI.mockResolvedValue(
      gptResponse(JSON.stringify({ learning_style: 'visual', confidence: 0.8 })),
    );
    const { inferLearningStyle } = await import('@/lib/engine/assignmentGen');
    const s = await inferLearningStyle('avg time 30000ms');
    expect(s.learning_style).toBe('visual');
    expect(s.confidence).toBe(0.8);
  });

  it('GPT throws LlmExhaustedError → degrades to emerging, confidence 0 (C1 throw-path)', async () => {
    mockOpenAI.mockRejectedValue(new LlmExhaustedError('openai'));
    const { inferLearningStyle } = await import('@/lib/engine/assignmentGen');
    // Must NOT rethrow — must degrade
    const s = await inferLearningStyle('some signals');
    expect(s.learning_style).toBe('emerging');
    expect(s.confidence).toBe(0);
  });

  it('GPT returns unparseable JSON → emerging, confidence 0', async () => {
    mockOpenAI.mockResolvedValue(gptResponse('not-valid-json'));
    const { inferLearningStyle } = await import('@/lib/engine/assignmentGen');
    const s = await inferLearningStyle('some signals');
    expect(s.learning_style).toBe('emerging');
    expect(s.confidence).toBe(0);
  });

  it('GPT returns invalid schema → emerging, confidence 0', async () => {
    mockOpenAI.mockResolvedValue(gptResponse(JSON.stringify({ learning_style: 'unknown_mode', confidence: 0.5 })));
    const { inferLearningStyle } = await import('@/lib/engine/assignmentGen');
    const s = await inferLearningStyle('some signals');
    expect(s.learning_style).toBe('emerging');
    expect(s.confidence).toBe(0);
  });
});
