// src/lib/engine/__tests__/assignmentGen.test.ts
// Tests for generateAssignment (engine call #5, Claude→GPT) + inferLearningStyle (#5a)
//
// Mandatory cases (task-8-corrections.md):
//   C1 throw-paths: Claude throws → GPT fallback; both throw → LlmExhaustedError
//   C1 inferLearningStyle: throws → emerging (degrade, never rethrow)
//   Null-path cases kept alongside throw-paths per spec.
//   Model routing: claudeChat is called with CLAUDE_GEN_MODEL in options.model.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { CLAUDE_GEN_MODEL } from '@/lib/ai/models';

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

  it('claudeChat is called with CLAUDE_GEN_MODEL in options.model (routing assertion)', async () => {
    mockClaude.mockResolvedValue(ASSIGNMENT);
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    await generateAssignment({
      lessonSummary: 'Fractions intro',
      band: 'reteach',
      style: 'visual',
      studentName: 'Sam',
    });
    // 3rd arg (options) must contain model === CLAUDE_GEN_MODEL
    const options = mockClaude.mock.calls[0][2] as { model?: string };
    expect(options?.model).toBe(CLAUDE_GEN_MODEL);
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

// ── generateAssignment — sectioned skillTargets path ─────────────────────────

describe('generateAssignment — sectioned skillTargets', () => {
  beforeEach(() => {
    mockClaude.mockReset();
    mockOpenAI.mockReset();
    vi.resetModules();
  });

  // A valid assignment with sectioned tasks (skill_id/skill_name/power_skill present)
  const SECTIONED_OBJ = {
    ...ASSIGNMENT_OBJ,
    tasks: [
      {
        step: 1,
        description: 'Identify a fraction',
        type: 'draw' as const,
        strategy: 'Text Detective',
        atl_skill: 'Thinking',
        ib_attribute: 'Thinkers',
        bloom_level: 'Understand',
        skill_id: 'frac',
        skill_name: 'Fractions',
        power_skill: 'Monitor',
      },
      {
        step: 2,
        description: 'Analyze a decimal',
        type: 'write' as const,
        strategy: 'Idea Mapping',
        atl_skill: 'Thinking',
        ib_attribute: 'Thinkers',
        bloom_level: 'Analyze',
        skill_id: 'dec',
        skill_name: 'Decimals',
        power_skill: 'Analyze',
      },
    ],
  };
  const SECTIONED = JSON.stringify(SECTIONED_OBJ);

  it('prompt contains SKILL SECTIONS when skillTargets provided', async () => {
    mockClaude.mockResolvedValue(SECTIONED);
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    await generateAssignment({
      lessonSummary: 'Fractions and Decimals',
      band: 'grade_level',
      style: 'visual',
      studentName: 'Sam',
      skillTargets: [
        { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded', verb: 'Reinforce', confident: true },
        { skill_id: 'dec', skill_name: 'Decimals', level: 'extension', verb: 'Enrich', confident: true },
      ],
    });
    const prompt = mockClaude.mock.calls[0][1] as string;
    expect(prompt).toContain('SKILL SECTIONS');
    expect(prompt.indexOf('Fractions')).toBeLessThan(prompt.indexOf('Decimals'));
    expect(prompt).toContain('OVERRIDE');
    expect(prompt).toMatch(/FORBIDDEN IN STUDENT-VISIBLE TEXT/);
  });

  it('prompt does NOT contain SKILL SECTIONS when no skillTargets (single-band path unchanged)', async () => {
    mockClaude.mockResolvedValue(ASSIGNMENT);
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    await generateAssignment({
      lessonSummary: 'Fractions intro',
      band: 'reteach',
      style: 'visual',
      studentName: 'Sam',
    });
    const prompt = mockClaude.mock.calls[0][1] as string;
    expect(prompt).not.toContain('SKILL SECTIONS');
  });

  it('sectioned LLM response preserves skill_id/skill_name/power_skill on tasks', async () => {
    mockClaude.mockResolvedValue(SECTIONED);
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    const out = await generateAssignment({
      lessonSummary: 'Fractions and Decimals',
      band: 'grade_level',
      style: 'visual',
      studentName: 'Sam',
      skillTargets: [
        { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded', verb: 'Reinforce', confident: true },
        { skill_id: 'dec', skill_name: 'Decimals', level: 'extension', verb: 'Enrich', confident: true },
      ],
    });
    expect(out.tasks[0].skill_id).toBe('frac');
    expect(out.tasks[0].skill_name).toBe('Fractions');
    expect(out.tasks[0].power_skill).toBe('Monitor');
    expect(out.tasks[1].skill_id).toBe('dec');
    expect(out.tasks[1].skill_name).toBe('Decimals');
    expect(out.tasks[1].power_skill).toBe('Analyze');
  });
});

// ── FIX 2+7: finalizeAssignment — step renumber + skill_id snap ──────────────

describe('generateAssignment — finalizeAssignment (step renumber + skill_id snap)', () => {
  beforeEach(() => {
    mockClaude.mockReset();
    mockOpenAI.mockReset();
    vi.resetModules();
  });

  it('FIX 2: duplicate steps from a sectioned LLM response are renumbered to [1,2,3,4]', async () => {
    // LLM restarts step numbering per section: [1,2,1,2] → finalizeAssignment renumbers to [1,2,3,4]
    const duplicateStepObj = {
      ...ASSIGNMENT_OBJ,
      tasks: [
        { step: 1, description: 'Task A', type: 'write' as const, strategy: 'Goal First', atl_skill: 'Thinking', ib_attribute: 'Thinkers', bloom_level: 'Understand', skill_id: 'frac', skill_name: 'Fractions', power_skill: 'Monitor' },
        { step: 2, description: 'Task B', type: 'draw' as const, strategy: 'Idea Mapping', atl_skill: 'Thinking', ib_attribute: 'Thinkers', bloom_level: 'Remember', skill_id: 'frac', skill_name: 'Fractions', power_skill: 'Monitor' },
        { step: 1, description: 'Task C', type: 'write' as const, strategy: 'Explain It', atl_skill: 'Communication', ib_attribute: 'Communicators', bloom_level: 'Understand', skill_id: 'dec', skill_name: 'Decimals', power_skill: 'Communicate' },
        { step: 2, description: 'Task D', type: 'analyze' as const, strategy: 'Text Detective', atl_skill: 'Research', ib_attribute: 'Inquirers', bloom_level: 'Analyze', skill_id: 'dec', skill_name: 'Decimals', power_skill: 'Research' },
      ],
    };
    mockClaude.mockResolvedValue(JSON.stringify(duplicateStepObj));
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    const out = await generateAssignment({
      lessonSummary: 'Fractions and Decimals',
      band: 'grade_level',
      style: 'visual',
      studentName: 'Sam',
      skillTargets: [
        { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded', verb: 'Reinforce', confident: true },
        { skill_id: 'dec', skill_name: 'Decimals', level: 'extension', verb: 'Enrich', confident: true },
      ],
    });
    // Steps must be renumbered 1→4 regardless of what the LLM produced
    expect(out.tasks.map((t) => t.step)).toEqual([1, 2, 3, 4]);
  });

  it('FIX 7: a task with a garbled skill_id but matching skill_name gets skill_id snapped to the canonical section id', async () => {
    const garbledIdObj = {
      ...ASSIGNMENT_OBJ,
      tasks: [
        {
          step: 1,
          description: 'Fraction task',
          type: 'write' as const,
          strategy: 'Goal First',
          atl_skill: 'Thinking',
          ib_attribute: 'Thinkers',
          bloom_level: 'Understand',
          skill_id: 'GARBLED-UUID-NOT-CANONICAL',
          skill_name: 'Fractions',
          power_skill: 'Monitor',
        },
        {
          step: 2,
          description: 'Decimal task',
          type: 'draw' as const,
          strategy: 'Idea Mapping',
          atl_skill: 'Thinking',
          ib_attribute: 'Thinkers',
          bloom_level: 'Remember',
          skill_id: 'dec',
          skill_name: 'Decimals',
          power_skill: 'Think',
        },
      ],
    };
    mockClaude.mockResolvedValue(JSON.stringify(garbledIdObj));
    const { generateAssignment } = await import('@/lib/engine/assignmentGen');
    const out = await generateAssignment({
      lessonSummary: 'Fractions and Decimals',
      band: 'grade_level',
      style: 'visual',
      studentName: 'Sam',
      skillTargets: [
        { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded', verb: 'Reinforce', confident: true },
        { skill_id: 'dec', skill_name: 'Decimals', level: 'extension', verb: 'Enrich', confident: true },
      ],
    });
    // Garbled skill_id snapped to canonical 'frac' via skill_name match
    expect(out.tasks[0].skill_id).toBe('frac');
    // Correctly-matched skill_id preserved
    expect(out.tasks[1].skill_id).toBe('dec');
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
