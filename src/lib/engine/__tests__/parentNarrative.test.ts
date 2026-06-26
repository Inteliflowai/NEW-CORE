// src/lib/engine/__tests__/parentNarrative.test.ts
//
// Uses vi.spyOn (not vi.mock factory) — same proven pattern as generateDraft.test.ts.
// vi.restoreAllMocks() in beforeEach ensures spies are reset between tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as openaiMod from '@/lib/ai/openai';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { generateParentNarrative } from '@/lib/engine/parentNarrative';
import { parentLeaks } from '@/lib/copy/parentGuard';
import { parentNarrativePrompt, parentNarrativeColdStartPrompt } from '@/lib/openai/prompts';

// ── Helpers ────────────────────────────────────────────────────────────────────

function completion(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] } as Awaited<
    ReturnType<typeof openaiMod.resilientChatCompletion>
  >;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseCtx = {
  firstName: 'Alex',
  gradeTrendDirection: 'climbing' as const,
  hasGrowth: true,
  dataPoints: 5,
  learningStyleLabel: 'visual',
  recentTopics: ['Fractions', 'The Civil War'],
};

const coldStartCtx = {
  firstName: 'Sam',
  gradeTrendDirection: null,
  hasGrowth: false,
  dataPoints: 1,
  learningStyleLabel: null,
  recentTopics: [],
};

/** A fully clean narrative that should always pass parentLeaks. */
const cleanNarrative = {
  paragraphs: [
    "Alex has been putting real thought into their work lately, and it shows in the questions they have been asking.",
    "Alex tends to take in ideas best when they can see them visually — through diagrams and maps. At home, try drawing a quick sketch of a concept together, or using colored markers to organize notes.",
    "Lately the class has been exploring ideas around making connections between what they already know and new information they are encountering.",
    "Here are a few things worth trying at home: talking through what happened in class while cooking or driving, reading something together and asking what it reminded them of, or giving them space to explain something they learned.",
    "There is so much to celebrate about how Alex approaches their work — the curiosity, the effort, and the willingness to keep trying.",
  ],
  conversation_starters: [
    "What was one thing that surprised you today?",
    "If you had to explain something from this week to a younger kid, what would you pick?",
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateParentNarrative', () => {
  beforeEach(() => vi.restoreAllMocks());

  // (a) clean JSON output → source:'ai', every paragraph + starter passes parentLeaks
  it('(a) clean output → source:ai, all paragraphs + starters pass parentLeaks', async () => {
    vi.spyOn(openaiMod, 'resilientChatCompletion').mockResolvedValue(completion(cleanNarrative));

    const result = await generateParentNarrative(baseCtx);

    expect(result.source).toBe('ai');
    expect(result.paragraphs.length).toBeGreaterThan(0);
    for (const p of result.paragraphs) {
      expect(parentLeaks(p), `paragraph leaked: "${p}"`).toEqual([]);
    }
    for (const s of result.conversation_starters) {
      expect(parentLeaks(s), `starter leaked: "${s}"`).toEqual([]);
    }
  });

  // (b) first output has a leak ("working at grade level") then clean retry → 'ai_retry'
  it('(b) first output leaks then retry clean → source:ai_retry', async () => {
    const leakyNarrative = {
      paragraphs: [
        ...cleanNarrative.paragraphs.slice(0, 4),
        'Alex is working at grade level and making good improvements.',
      ],
      conversation_starters: cleanNarrative.conversation_starters,
    };
    vi.spyOn(openaiMod, 'resilientChatCompletion')
      .mockResolvedValueOnce(completion(leakyNarrative))
      .mockResolvedValueOnce(completion(cleanNarrative));

    const result = await generateParentNarrative(baseCtx);

    expect(result.source).toBe('ai_retry');
  });

  // (c) always-leaking → 'fallback'; assert fallback paragraphs + starters pass parentLeaks
  it('(c) always-leaking → source:fallback, fallback passes parentLeaks', async () => {
    const alwaysLeaky = {
      paragraphs: ['Alex scored at the advanced level on the assessment.'],
      conversation_starters: ['How many points did you earn?'],
    };
    vi.spyOn(openaiMod, 'resilientChatCompletion').mockResolvedValue(completion(alwaysLeaky));

    const result = await generateParentNarrative(baseCtx);

    expect(result.source).toBe('fallback');
    expect(result.paragraphs.length).toBeGreaterThan(0);
    expect(result.conversation_starters.length).toBeGreaterThan(0);
    for (const p of result.paragraphs) {
      expect(parentLeaks(p), `fallback paragraph leaked: "${p}"`).toEqual([]);
    }
    for (const s of result.conversation_starters) {
      expect(parentLeaks(s), `fallback starter leaked: "${s}"`).toEqual([]);
    }
  });

  // (d) resilientChatCompletion rejects with LlmExhaustedError → source:fallback, never throws
  it('(d) LlmExhaustedError → source:fallback, never throws', async () => {
    // Uses mockRejectedValue + vi.spyOn — same proven pattern as generateDraft.test.ts.
    vi.spyOn(openaiMod, 'resilientChatCompletion').mockRejectedValue(
      new LlmExhaustedError('openai'),
    );

    const result = await generateParentNarrative(baseCtx);

    expect(result.source).toBe('fallback');
    // Test completing without throwing is itself the "never throws" assertion
  });

  // (e) I2 malformed/empty-shape JSON ('{}') → 'fallback', NO throw (TypeError must not escape)
  it('(e) I2: empty shape {} → source:fallback, no TypeError escapes', async () => {
    vi.spyOn(openaiMod, 'resilientChatCompletion').mockResolvedValue({
      choices: [{ message: { content: '{}' } }],
    } as Awaited<ReturnType<typeof openaiMod.resilientChatCompletion>>);

    const result = await generateParentNarrative(baseCtx);

    expect(result.source).toBe('fallback');
    // No throw = TypeError is caught by the shape guard
  });

  // (f) I4 cold-start + model invents "climbing steadily" → rejected → fallback
  it('(f) I4: cold-start with fabricated direction word "climbing" → rejected → fallback', async () => {
    const fabricatedTrend = {
      paragraphs: [
        'Sam is just getting started on their learning journey.',
        'Sam has been climbing steadily in their understanding of new ideas.',
        'Talking with Sam about their day is always a great way to connect.',
        'There are wonderful ways to support learning at home every day.',
        'Sam brings tremendous curiosity to everything they do.',
      ],
      conversation_starters: ['What did you enjoy today?', 'What felt tricky?'],
    };
    // Both calls return the fabricated direction word
    vi.spyOn(openaiMod, 'resilientChatCompletion').mockResolvedValue(completion(fabricatedTrend));

    const result = await generateParentNarrative(coldStartCtx);

    expect(result.source).toBe('fallback');
  });

  // (g) I3: the assembled user prompt contains the literal word "json"
  it('(g) I3: parentNarrativePrompt and cold-start variant both contain "json"', () => {
    const warmPrompt = parentNarrativePrompt(baseCtx);
    expect(warmPrompt.toLowerCase()).toContain('json');

    const coldPrompt = parentNarrativeColdStartPrompt(coldStartCtx);
    expect(coldPrompt.toLowerCase()).toContain('json');
  });

  // (h) I9/I8: digit-stripped topics in context + avoid-word in input → source:'ai' on clean output
  it('(h) I9/I8: digit-stripped topics + clean model output → source:ai', async () => {
    vi.spyOn(openaiMod, 'resilientChatCompletion').mockResolvedValue(completion(cleanNarrative));
    const ctxWithTopics = {
      ...baseCtx,
      recentTopics: ['Fractions', 'Civil War', 'Algebra'],
    };

    const result = await generateParentNarrative(ctxWithTopics);

    expect(result.source).toBe('ai');
  });
});
