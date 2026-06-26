// src/lib/copy/__tests__/parentGuard.test.ts
import { describe, it, expect } from 'vitest';
import { parentLeaks, hasParentLeak } from '@/lib/copy/parentGuard';

describe('parentGuard — CLEAN warm prose passes', () => {
  const cleanCases = [
    "Alex's reading is trending up — keep celebrating the effort and curiosity.",
    "the reasoning behind her answer was thoughtful",
    "approaching new problems with curiosity",
    // NOTE: "enrich"/"enriching" are now BANNED — removed from clean cases (M1)
    "Alex is a wonderful role model at home",
  ];

  for (const text of cleanCases) {
    it(`passes: "${text.slice(0, 60)}"`, () => {
      expect(parentLeaks(text)).toEqual([]);
      expect(hasParentLeak(text)).toBe(false);
    });
  }
});

describe('parentGuard — CAUGHT leaks', () => {
  const caughtCases: [string, string][] = [
    // digit / %
    ['scored 87% on the quiz', 'a number or percent'],
    // banned word (model in ML sense)
    ['the model says she needs extra help', 'a data word'],
    // FOUR_AUDIENCE_LEAKS — working at grade level
    ['she is working at grade level now', 'a level word'],
    // FOUR_AUDIENCE_LEAKS — ahead of the class
    ['Alex is ahead of the class in reading', 'a comparison'],
    // C2: hyphen variants — grade-level
    ['this is grade-level work', 'a level word'],
    // C2: hyphen variants — on-track
    ['she is on-track for the semester', 'on track'],
    // parent gaps below
    ['there is a risk she will fall behind', 'risk'],
    ["we'll reinforce this concept tomorrow", 'reinforce'],
    ['her comprehension level is developing', 'comprehension level'],
    ['she is approaching grade level', 'approaching (band)'],
    ['this shows partial mastery of the skill', 'partial mastery'],
    ['a misconception came up in her work', 'misconception'],
    ['compared to last month', 'compared to'],
    ['compared with the rest of her class', 'compared with'],
    ['she is falling behind in vocabulary', 'falling behind'],
    ['she is behind the class in reading', 'behind (comparison)'],
    ['the class average for this unit', 'class average'],
    ['she is outperforming her peers', 'peers'],
    ['unlike other students, she prefers', 'other students'],
    ['she performs better than average', 'than average'],
    ['she is ahead of the rest of the class', 'rest of the class'],
    ['reading at an A level', 'a letter grade'],
    ["she's getting straight A's this year", 'straight As'],
    ['earned a solid B this semester', 'a letter grade'],
    // M1 morphology regression cases
    ['she has some misconceptions about fractions', 'misconception'],
    ['comprehension levels vary widely', 'comprehension level'],
    ['the school uses reinforcement techniques', 'reinforce'],
    ['she is reinforcing her skills daily', 'reinforce'],
    ['the topic needs further reinforcing', 'reinforce'],
    ['ways to enrich reading at home', 'enrichment'],
    ['enriching activities help learning', 'enrichment'],
    ['she has enriched her vocabulary', 'enrichment'],
    ['there are risks in skipping practice', 'risk'],
  ];

  for (const [text, expectedPhrase] of caughtCases) {
    it(`catches "${expectedPhrase}" in: "${text.slice(0, 60)}"`, () => {
      const leaks = parentLeaks(text);
      expect(leaks.length).toBeGreaterThan(0);
      expect(leaks).toContain(expectedPhrase);
      expect(hasParentLeak(text)).toBe(true);
    });
  }
});
