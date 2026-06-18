// ============================================================
// lib/openai/prompts.ts
// CORE V2 — AI Prompt Contracts
// LIFT verbatim from V1 lib/openai/prompts.ts
// Includes Inteliflow Learning Strategy Toolkit + ATL + IB mapping
// ============================================================

import { MATH_FORMAT_DIRECTIVE } from '@/lib/math/mathPromptDirective';

// ============================================================
// INTELIFLOW LEARNING STRATEGY TOOLKIT
// 12 strategies across 5 categories
// Each mapped to: ATL skill + IB Learner Profile + learning styles
// ============================================================

export const INTELIFLOW_STRATEGIES = {
  // ── Learning Preparation ──────────────────────────────────
  goal_first: {
    name: 'Goal First',
    category: 'Learning Preparation',
    what_students_do: 'Students identify the learning goal before beginning a task or lesson.',
    learning_styles: ['visual', 'text'],
    critical_thinking_skill: 'Monitor',
    learning_outcome: 'Students focus attention and understand what success looks like.',
    atl_skills: ['Self-management', 'Thinking'],
    atl_categories: {
      self_management: 'Organization — setting goals and managing focus',
      thinking: 'Critical thinking — evaluating purpose before acting',
    },
    ib_learner_profile: ['Reflective', 'Principled'],
    bloom_level: 'Understand',
    band_fit: ['reteach', 'grade_level', 'advanced'],
  },
  knowledge_bridge: {
    name: 'Knowledge Bridge',
    category: 'Learning Preparation',
    what_students_do: 'Students recall what they already know about a topic before learning new information.',
    learning_styles: ['visual', 'auditory'],
    critical_thinking_skill: 'Think',
    learning_outcome: 'Students connect new ideas to existing knowledge.',
    atl_skills: ['Thinking', 'Self-management'],
    atl_categories: {
      thinking: 'Transfer — connecting prior knowledge to new concepts',
      self_management: 'Affective — activating prior learning',
    },
    ib_learner_profile: ['Knowledgeable', 'Thinkers'],
    bloom_level: 'Remember / Understand',
    band_fit: ['reteach', 'grade_level'],
  },
  quick_look: {
    name: 'Quick Look',
    category: 'Learning Preparation',
    what_students_do: 'Students quickly survey headings, visuals, charts, and keywords before reading deeply.',
    learning_styles: ['visual'],
    critical_thinking_skill: 'Research',
    learning_outcome: 'Students understand how information is organized before studying it.',
    atl_skills: ['Research', 'Thinking'],
    atl_categories: {
      research: 'Information literacy — navigating and previewing sources',
      thinking: 'Critical thinking — identifying structure and patterns',
    },
    ib_learner_profile: ['Inquirers', 'Knowledgeable'],
    bloom_level: 'Remember',
    band_fit: ['reteach', 'grade_level', 'advanced'],
  },

  // ── Information Processing ────────────────────────────────
  text_detective: {
    name: 'Text Detective',
    category: 'Information Processing',
    what_students_do: 'Students highlight, underline, and write notes directly on a text.',
    learning_styles: ['visual', 'text'],
    critical_thinking_skill: 'Research',
    learning_outcome: 'Students actively analyze and interpret information while reading.',
    atl_skills: ['Research', 'Thinking'],
    atl_categories: {
      research: 'Information literacy — interpreting and evaluating sources',
      thinking: 'Critical thinking — analyzing evidence',
    },
    ib_learner_profile: ['Thinkers', 'Inquirers'],
    bloom_level: 'Analyze',
    band_fit: ['reteach', 'grade_level'],
  },
  question_quest: {
    name: 'Question Quest',
    category: 'Information Processing',
    what_students_do: 'Students generate questions about information while reading or learning. Share questions with a partner or group.',
    learning_styles: ['auditory', 'text'],
    critical_thinking_skill: 'Think',
    learning_outcome: 'Students deepen understanding through inquiry.',
    atl_skills: ['Thinking', 'Communication'],
    atl_categories: {
      thinking: 'Creative thinking — generating inquiry questions',
      communication: 'Communication — sharing and discussing ideas',
    },
    ib_learner_profile: ['Inquirers', 'Communicators'],
    bloom_level: 'Analyze / Evaluate',
    band_fit: ['grade_level', 'advanced'],
  },
  explain_it: {
    name: 'Explain It',
    category: 'Information Processing',
    what_students_do: 'Students restate the most important ideas in their own words.',
    learning_styles: ['text'],
    critical_thinking_skill: 'Communicate',
    learning_outcome: 'Students consolidate and retain key concepts.',
    atl_skills: ['Communication', 'Thinking'],
    atl_categories: {
      communication: 'Communication — expressing understanding clearly',
      thinking: 'Critical thinking — synthesizing information',
    },
    ib_learner_profile: ['Communicators', 'Thinkers'],
    bloom_level: 'Understand',
    band_fit: ['reteach', 'grade_level'],
  },

  // ── Organization ─────────────────────────────────────────
  note_builder: {
    name: 'Note Builder',
    category: 'Organization',
    what_students_do: 'Students record key ideas while listening, reading, or observing.',
    learning_styles: ['text'],
    critical_thinking_skill: 'Monitor',
    learning_outcome: 'Students capture and organize important information for later use.',
    atl_skills: ['Self-management', 'Research'],
    atl_categories: {
      self_management: 'Organization — managing and recording information',
      research: 'Information literacy — recording and citing information',
    },
    ib_learner_profile: ['Knowledgeable', 'Principled'],
    bloom_level: 'Remember / Understand',
    band_fit: ['reteach', 'grade_level'],
  },
  idea_mapping: {
    name: 'Idea Mapping',
    category: 'Organization',
    what_students_do: 'Students organize information visually using charts, diagrams, or concept maps.',
    learning_styles: ['visual', 'kinesthetic'],
    critical_thinking_skill: 'Think',
    learning_outcome: 'Students understand relationships between ideas.',
    atl_skills: ['Thinking', 'Self-management'],
    atl_categories: {
      thinking: 'Critical thinking — organizing and representing knowledge',
      self_management: 'Organization — structuring learning visually',
    },
    ib_learner_profile: ['Thinkers', 'Knowledgeable'],
    bloom_level: 'Understand / Analyze',
    band_fit: ['reteach', 'grade_level', 'advanced'],
  },

  // ── Discussion & Collaboration ────────────────────────────
  idea_exchange: {
    name: 'Idea Exchange',
    category: 'Discussion & Collaboration',
    what_students_do: 'Students explain ideas, share perspectives, and respond to others.',
    learning_styles: ['auditory', 'social'],
    critical_thinking_skill: 'Communicate',
    learning_outcome: 'Students clarify and strengthen understanding through conversation.',
    atl_skills: ['Communication', 'Social'],
    atl_categories: {
      communication: 'Communication — presenting ideas and listening actively',
      social: 'Collaboration — respecting and responding to peers',
    },
    ib_learner_profile: ['Communicators', 'Open-minded'],
    bloom_level: 'Evaluate',
    band_fit: ['grade_level', 'advanced'],
  },
  think_talk_share: {
    name: 'Think-Talk-Share',
    category: 'Discussion & Collaboration',
    what_students_do: 'Students think individually, discuss ideas with a partner, and share with the group.',
    learning_styles: ['auditory', 'social'],
    critical_thinking_skill: 'Collaborate',
    learning_outcome: 'Students develop ideas through structured peer interaction.',
    atl_skills: ['Social', 'Communication', 'Thinking'],
    atl_categories: {
      social: 'Collaboration — building on others ideas',
      communication: 'Communication — structured discussion',
      thinking: 'Critical thinking — individual reflection before sharing',
    },
    ib_learner_profile: ['Communicators', 'Caring', 'Open-minded'],
    bloom_level: 'Understand / Evaluate',
    band_fit: ['grade_level', 'advanced'],
  },
  comprehension_crew: {
    name: 'Comprehension Crew',
    category: 'Discussion & Collaboration',
    what_students_do: 'Students work together to analyze information or complete tasks.',
    learning_styles: ['social', 'kinesthetic'],
    critical_thinking_skill: 'Collaborate',
    learning_outcome: 'Students build knowledge collectively and practice teamwork.',
    atl_skills: ['Social', 'Thinking'],
    atl_categories: {
      social: 'Collaboration — delegating, supporting, and working as a team',
      thinking: 'Critical thinking — analyzing through group discussion',
    },
    ib_learner_profile: ['Caring', 'Balanced', 'Communicators'],
    bloom_level: 'Analyze',
    band_fit: ['reteach', 'grade_level'],
  },

  // ── Metacognition & Reflection ────────────────────────────
  pause_and_reflect: {
    name: 'Pause & Reflect',
    category: 'Metacognition & Reflection',
    what_students_do: 'Students pause to reflect on what they understood and how they learned it.',
    learning_styles: ['visual', 'text'],
    critical_thinking_skill: 'Monitor',
    learning_outcome: 'Students become independent learners who adjust strategies.',
    atl_skills: ['Thinking', 'Self-management'],
    atl_categories: {
      thinking: 'Reflection — metacognitive awareness of learning',
      self_management: 'Affective — self-regulation and strategy adjustment',
    },
    ib_learner_profile: ['Reflective', 'Balanced'],
    bloom_level: 'Evaluate',
    band_fit: ['reteach', 'grade_level', 'advanced'],
  },
};

// ── ATL Skill → Strategy mapping (for quick lookup) ──────────
export const ATL_TO_STRATEGIES: Record<string, string[]> = {
  Thinking: ['goal_first', 'knowledge_bridge', 'quick_look', 'text_detective', 'question_quest', 'explain_it', 'idea_mapping', 'think_talk_share', 'comprehension_crew', 'pause_and_reflect'],
  Communication: ['question_quest', 'explain_it', 'idea_exchange', 'think_talk_share'],
  Social: ['idea_exchange', 'think_talk_share', 'comprehension_crew'],
  'Self-management': ['goal_first', 'knowledge_bridge', 'note_builder', 'idea_mapping', 'pause_and_reflect'],
  Research: ['quick_look', 'text_detective', 'note_builder'],
};

// ── Learning style → best strategies ─────────────────────────
export const STYLE_TO_STRATEGIES: Record<string, string[]> = {
  visual: ['goal_first', 'knowledge_bridge', 'quick_look', 'text_detective', 'idea_mapping', 'pause_and_reflect'],
  auditory: ['knowledge_bridge', 'question_quest', 'idea_exchange', 'think_talk_share'],
  read_write: ['goal_first', 'text_detective', 'question_quest', 'explain_it', 'note_builder', 'pause_and_reflect'],
  kinesthetic: ['idea_mapping', 'comprehension_crew', 'think_talk_share'],
  tactile: ['idea_mapping', 'comprehension_crew', 'goal_first', 'note_builder'],
  social: ['idea_exchange', 'think_talk_share', 'comprehension_crew'],
  emerging: ['goal_first', 'explain_it', 'note_builder', 'pause_and_reflect'],
};

// ── Band → recommended strategy categories ───────────────────
export const BAND_TO_STRATEGY_FOCUS: Record<string, string[]> = {
  reteach: ['Learning Preparation', 'Information Processing', 'Organization'],
  grade_level: ['Information Processing', 'Organization', 'Discussion & Collaboration'],
  advanced: ['Discussion & Collaboration', 'Metacognition & Reflection', 'Information Processing'],
};

// ── Helper: get best strategies for band + style ─────────────
export function getStrategiesForStudent(band: string, style: string): typeof INTELIFLOW_STRATEGIES[keyof typeof INTELIFLOW_STRATEGIES][] {
  const styleKey = style in STYLE_TO_STRATEGIES ? style : 'emerging';
  const styleStrategies = STYLE_TO_STRATEGIES[styleKey];
  const bandCategories = BAND_TO_STRATEGY_FOCUS[band] || BAND_TO_STRATEGY_FOCUS.grade_level;

  return Object.values(INTELIFLOW_STRATEGIES).filter(s =>
    styleStrategies.includes(Object.keys(INTELIFLOW_STRATEGIES).find(k =>
      (INTELIFLOW_STRATEGIES as Record<string, typeof s>)[k] === s
    ) || '') &&
    bandCategories.includes(s.category) &&
    s.band_fit.includes(band)
  ).slice(0, 3);
}

// ============================================================
// PROMPT CONTRACTS
// ============================================================

// ---- 1. LESSON PARSE ----

export const LESSON_PARSE_SYSTEM = `You are an expert curriculum analyst for K-12 education.
Parse the lesson document and extract structured information.
Return ONLY valid JSON. No markdown, no explanation, no preamble.`;

export function lessonParsePrompt(text: string): string {
  return `Parse this lesson and return a JSON object:
{
  "title": "lesson title if found",
  "key_concepts": ["concept1", ...],
  "objectives": ["By end of lesson students will..."],
  "vocabulary": [{"term": "word", "definition": "plain definition"}],
  "misconception_risks": ["common misunderstanding..."],
  "grade_level": "estimated e.g. 7th grade",
  "subject": "e.g. Science",
  "summary": "2-3 sentence plain summary"
}
Rules: 4-8 concepts, 2-5 objectives, 5-10 vocab terms, 2-4 misconceptions.
Return ONLY the JSON object.

LESSON:
${text}`;
}

// ---- 2. QUIZ GENERATION ----

// LOCK #4 (Barb 2026-05-06): every question must MEASURE THIS
// LESSON. Alignment, rigor, clarity, balance. The eval rig flags
// trivia, vocabulary-only, giveaway-phrased, difficulty-mismatched,
// and goal-disconnected questions as regressions.
export const QUIZ_GENERATE_SYSTEM = `You are an expert K-12 assessment designer.

Your job: generate a quiz that ACTUALLY MEASURES THIS LESSON.

The four qualities every quiz must have: alignment (every question
traces to a stated learning objective), rigor (questions require
thinking, not recall of trivia), clarity (the question asks one thing
clearly), balance (range of difficulty + question type).

REGRESSION PATTERNS — never generate questions that are:
- Trivia (testable from general knowledge, not from THIS lesson)
- Vocabulary-only (testing a term's recognition without testing the
  underlying concept)
- Cued in wording (the question gives the answer away — e.g.
  "Photosynthesis is the process by which plants convert sunlight
  into ___" cues the answer in the setup)
- Difficulty-mismatched (too easy = no thinking required;
  too hard = testing material the lesson doesn't cover)
- Disconnected from learning goals (on-topic but doesn't measure any
  stated objective)

WRITING QUALITY: Students read every question and answer choice
verbatim on a timed quiz. Every question_text, choice, and rubric must
be written in complete, grammatically correct sentences with correct
spelling and punctuation, in the same language as the lesson content.
Proofread each question before returning it — a typo or a garbled
sentence costs a student time they don't have.

Return ONLY valid JSON. No markdown, no explanation, no preamble.
${MATH_FORMAT_DIRECTIVE}`;

export function quizGeneratePrompt(parsedLesson: string): string {
  return `Generate a 5-question quiz (3 MCQ + 2 open-response) from this lesson data.

Return:
{
  "title": "Quiz: [lesson topic]",
  "questions": [
    {
      "position": 1,
      "question_type": "mcq",
      "question_text": "...",
      "choices": [
        {"label": "A", "text": "..."},
        {"label": "B", "text": "..."},
        {"label": "C", "text": "..."},
        {"label": "D", "text": "..."}
      ],
      "correct_answer": "A",
      "concept_tag": "relevant concept"
    },
    {
      "position": 4,
      "question_type": "open",
      "question_text": "Explain...",
      "rubric": "A complete answer includes: ...",
      "concept_tag": "relevant concept"
    }
  ]
}

Rules:
- Positions 1-3 are MCQ, positions 4-5 are open-response
- MCQ must test understanding not just recall
- Open questions require reasoning
- SELF-CONTAINMENT (CRITICAL): The student is taking a 15-minute timed quiz with NO outside materials, NO textbook, NO notes, NO prior assignments. If a question references a paragraph, stanza, chart, table, equation, image, quote, scene, dataset, or any other concrete artifact, that COMPLETE content MUST appear inline in the question_text.
  * NEVER say "the paragraph above", "this stanza", "the chart", "the example we read" — there is no above, no this, no we. Every question must stand alone.
  * NEVER ask the student to analyze, compare, or identify "a paragraph from a novel", "a stanza from a poem", "a scene from the play", "an example from your reading", "a passage you've seen", "a graph", "a quote" — or ANY other generic/hypothetical artifact you have not embedded in question_text. Generic prompts that require the student to find, recall, or invent their own example are FORBIDDEN. The student has nothing to refer to.
  * If you intend to ask about a paragraph, EMBED THE FULL PARAGRAPH (in quotation marks) inside question_text. Same for stanzas, charts, equations, scenes. If the artifact is too long to embed in a quiz question, drop the question — it's too big for the format.
- COMPLEXITY-FOR-TIME: Each open-response question must be answerable in 3-5 minutes by a student in this band. NO multi-part prompts, NO compare-and-contrast across two separate texts, NO "analyze X and Y" unless both X and Y are short and embedded in the question. If you'd need a class period to answer it, it's too big.
- DIFFICULTY CALIBRATION: Match each question's cognitive demand to the grade level in the lesson data (the "grade_level" field). Test the lesson's concepts at the Bloom level appropriate for that grade — never push beyond it:
  * Grades K-2: Bloom Remember / Understand only.
  * Grades 3-5: Remember, Understand, Apply.
  * Grades 6-8: Understand, Apply, Analyze.
  * Grades 9-12: Apply, Analyze, Evaluate — but ONLY on concepts explicitly taught in THIS lesson; never test reasoning the lesson didn't build.
  This calibration is the SAME for every student in the class — the quiz is a shared diagnostic, never personalized per student. A foundational lesson must not get questions demanding synthesis it never taught; that is the "difficulty-mismatched" regression.

SELF-CHECK — read each question after writing it:
- "Could a student answer this with ONLY what is written in question_text — no other inputs?" If the answer is no, the question is broken. Either embed the missing artifact in question_text, or rewrite the question to ask about something already self-contained.
- "Does this question trace to a stated learning objective from THIS lesson?" If you can't name the objective the question measures, the question is disconnected — rewrite or drop.
- "Could the answer be guessed from the question's wording alone?" If yes, you've cued the answer — rewrite to remove the giveaway.
- "Does this test the CONCEPT or just terminology?" Vocabulary-only questions ("What is photosynthesis?") fail this check. Concept questions ("Why does a plant need both light and water for photosynthesis?") pass.
- "Is this question at or below the Bloom ceiling for the lesson's grade level?" A question demanding reasoning the lesson never taught is difficulty-mismatched — rewrite it down to the grade, or drop it.
- "Is every sentence in the question and its answer choices grammatically correct, correctly spelled, and correctly punctuated?" If not, fix the wording before returning — students read this text verbatim under time pressure.
Do NOT ship a question that fails any of these checks.

- Return ONLY the JSON object

LESSON DATA:
${parsedLesson}`;
}

// ---- 2b. MATH QUIZ GENERATION (STEM-ONLY) ----
//
// Additive, STEM-gated variant of the quiz prompt. Used ONLY when the
// lesson/class subject is math/STEM (isStemSubject). The non-STEM path
// (QUIZ_GENERATE_SYSTEM + quizGeneratePrompt above) is UNCHANGED and
// stays byte-identical for every other subject.
//
// The math quiz keeps the same 5-question structure the grader + scoring
// rely on, but the first three positions are NUMERIC questions
// (question_type: "numeric") that grade deterministically in code
// (lib/math/checkNumericAnswer.ts) with no LLM. Each numeric question
// carries a numeric_spec { accepted: string[], tolerance?: number } and a
// canonical correct_answer (a fallback the grader reads). Positions 4-5
// stay open-response (reasoning / word problems) graded by the LLM, so
// the math quiz still measures explanation, not just final answers.
//
// The numeric question object reuses the same shape the parser expects,
// plus the numeric_spec field — no schema fork.
export const MATH_QUIZ_INSTRUCTION = `
═══════════════════════════════════════
MATH QUIZ MODE — THIS IS A STEM / MATH LESSON
═══════════════════════════════════════
This lesson is math/STEM. Generate a MATH quiz: the first three
questions are NUMERIC (a single numeric answer the student computes),
and the last two are short open-response reasoning / word problems.

NUMERIC QUESTIONS (positions 1-3) — use "question_type": "numeric":
- "question_text": the problem, with ALL math written in LaTeX \\( ... \\)
  per the math-formatting rules (e.g. \\(\\frac{3}{4} + \\frac{1}{8}\\)).
  The question must be fully self-contained: every number, expression,
  table, or figure the student needs is written inline in question_text.
- "correct_answer": the ONE canonical correct value as a plain string a
  student would type (e.g. "0.875" or "7/8"). This is the grader's
  fallback — always include it.
- "numeric_spec": an object listing the EQUIVALENT accepted forms and a
  tolerance:
    { "accepted": ["0.875", "7/8"], "tolerance": 0 }
  * "accepted": every form that should count as correct — include the
    canonical value plus any mathematically-equal forms a student might
    type (decimal, fraction, percent, mixed number). The deterministic
    checker compares by VALUE, so list the forms you want to accept, e.g.
    ["0.5", "1/2", "50%"]. NEVER list a wrong value here.
  * "tolerance": 0 when the answer is exact. Use a small tolerance (e.g.
    0.01) ONLY when the question explicitly asks the student to round
    ("round to two decimal places" → 0.005). When in doubt, use 0.
- Do NOT include "choices" — numeric questions are free-entry, not MCQ.
- Every numeric question MUST have a single, unambiguous numeric answer.
  If a question would have multiple valid answers or no clean numeric
  result, rewrite it so it has exactly one numeric value (then list its
  equivalent forms in accepted), or make it one of the two open questions.

OPEN QUESTIONS (positions 4-5) — use "question_type": "open":
- Same shape as the standard quiz: "question_text" + "rubric". These are
  reasoning prompts or word problems where the student must EXPLAIN their
  thinking or show a method — not just produce a number. Write any math in
  LaTeX \\( ... \\). Self-contained, answerable in 3-5 minutes.

STRUCTURE (LOCKED — exactly 5 questions):
- Positions 1, 2, 3: "question_type": "numeric" (with numeric_spec).
- Positions 4, 5: "question_type": "open" (with rubric).

Return shape for a numeric question:
{
  "position": 1,
  "question_type": "numeric",
  "question_text": "Compute \\(\\frac{3}{4} + \\frac{1}{8}\\).",
  "correct_answer": "0.875",
  "numeric_spec": { "accepted": ["0.875", "7/8"], "tolerance": 0 },
  "concept_tag": "adding fractions"
}

All other rules from the standard quiz instructions still apply:
self-containment, difficulty calibration to the lesson's grade level,
no trivia, no cued wording, and grammatically correct writing.`;

export function mathQuizGeneratePrompt(parsedLesson: string): string {
  return `Generate a 5-question MATH quiz (3 numeric + 2 open-response) from this lesson data.

${MATH_QUIZ_INSTRUCTION}

Return:
{
  "title": "Quiz: [lesson topic]",
  "questions": [
    {
      "position": 1,
      "question_type": "numeric",
      "question_text": "Compute \\(\\frac{3}{4} + \\frac{1}{8}\\).",
      "correct_answer": "0.875",
      "numeric_spec": { "accepted": ["0.875", "7/8"], "tolerance": 0 },
      "concept_tag": "relevant concept"
    },
    {
      "position": 4,
      "question_type": "open",
      "question_text": "A recipe needs \\(\\frac{2}{3}\\) cup of sugar for one batch. Explain how you would find the amount needed for \\(2\\frac{1}{2}\\) batches, and give the result.",
      "rubric": "A complete answer includes: ...",
      "concept_tag": "relevant concept"
    }
  ]
}

Rules:
- Positions 1-3 are NUMERIC (question_type: "numeric"), positions 4-5 are open-response (question_type: "open")
- Every numeric question MUST include both "correct_answer" (canonical value) AND "numeric_spec" ({ "accepted": [...], "tolerance": N })
- Numeric questions test computation/procedure; open questions require reasoning or a word problem the student explains
- SELF-CONTAINMENT (CRITICAL): The student is taking a timed quiz with NO outside materials. Every number, expression, table, or figure a question needs MUST appear inline in question_text. NEVER reference "the equation above", "the table we used", "the example" — there is none.
- COMPLEXITY-FOR-TIME: Each open question answerable in 3-5 minutes. NO multi-part prompts that need a whole class period.
- DIFFICULTY CALIBRATION: Match each question's cognitive demand to the grade level in the lesson data (the "grade_level" field). Test the lesson's concepts at the Bloom level appropriate for that grade — never push beyond it. The same quiz is given to every student in the class.

SELF-CHECK — read each question after writing it:
- "Does each numeric question have exactly ONE unambiguous numeric answer?" If not, rewrite it.
- "Does numeric_spec.accepted list every equivalent form of the correct value and NO wrong values?" If not, fix it.
- "Is tolerance 0 unless the question asks for rounding?" If rounding is required, set a small tolerance (e.g. 0.005 for 2 decimals).
- "Could a student answer this with ONLY what is written in question_text — no other inputs?" If no, embed the missing content or rewrite.
- "Does this question trace to a stated learning objective from THIS lesson?" If you can't name it, rewrite or drop.
- "Is all math written in LaTeX \\( ... \\), and is every sentence grammatically correct, correctly spelled, and correctly punctuated?" If not, fix before returning.
Do NOT ship a question that fails any of these checks.

- Return ONLY the JSON object

LESSON DATA:
${parsedLesson}`;
}

// ---- 3. OPEN-RESPONSE GRADING ----

// LOCK #1 (Barb 2026-05-06): score THINKING, not writing. A messy
// answer demonstrating real understanding beats a polished answer
// using vocabulary without grasp. See CLAUDE.md "AI grading scores
// THINKING, not writing" — the eval rig's grading corpus uses
// Barb's promote/reject reviews as canonical correct.
export const GRADING_SYSTEM = `You are an expert K-12 assessment scorer.

You are grading the QUALITY OF THINKING, not the quality of writing.
A messy response that demonstrates real understanding beats a polished
response using vocabulary without grasp.

WHAT NOT TO DO: Do not assume strong writing equals strong understanding.
Polish is not evidence of thinking. A well-organized paragraph that says
nothing of substance scores LOW. A messy or grammatically awkward
response that lands the right idea scores HIGH.

Score UP for: strong reasoning · evidence used to support a claim ·
clear thinking · transfer of knowledge to a new context · genuine
understanding · catching one's own misconception.

Score DOWN for: vague language · vocabulary used without understanding ·
guessing · surface-level responses · generic filler · claims without
evidence.

LANGUAGE RULES FOR cognitive_notes (the teacher reads this verbatim
under the question, and the student MAY see derived parent/teacher
output — stay factual, do not psychologize):
- Describe what the RESPONSE shows, never what the STUDENT "is" or "feels."
  Wrong: "Shows complete disengagement." Right: "The response did not
  include any analysis of the passage."
- Never use these words about a student's effort or engagement:
  disengaged, disengagement, lazy, careless, unmotivated, apathetic,
  inattentive, distracted, gave up, didn't try, didn't bother.
- For blank or near-blank responses (< 5 substantive words, "I don't
  know", "idk", random characters, copy of the prompt): the cognitive_notes
  MUST state the OBSERVABLE FACT only.
  Required pattern: "No response submitted" OR "Response was {N} words
  and did not address the question" OR "Response repeats the prompt
  without offering an answer". Then optionally one neutral sentence:
  "Cannot assess thinking on this question from this response."
- For very short attempted responses (1-2 sentences with some substance):
  describe what IS there, not what is missing. "Identifies the theme
  but does not explain its connection to the text" — not "shows minimal
  effort."

BLANK / NEAR-BLANK SCORING:
- A blank, "idk", or off-topic response is 0.0 score, error_type "blank",
  reasoning_pattern "blank_or_off_topic". cognitive_notes follows the
  observable-fact rule above.
- DO NOT score a blank response as anything other than 0.0. DO NOT add
  partial credit for "showing up."

Be fair, consistent, rubric-anchored. Return ONLY valid JSON. No
markdown, no explanation, no preamble.`;

export function gradingPrompt(
  questionText: string,
  rubric: string,
  response: string,
  rubricVersion = 'v1'
): string {
  return `Score this student open-response answer and extract cognitive signals.

QUESTION: ${questionText}
RUBRIC (${rubricVersion}): ${rubric}
STUDENT RESPONSE: ${response || '[no response / blank]'}

Return this exact JSON:
{
  "score": 0 | 0.5 | 1.0,
  "explanation": "1-2 sentence explanation of score",
  "confidence": 0.0-1.0,
  "grader_source": "ai",
  "error_type": "none | factual_error | reasoning_gap | incomplete | misunderstood_question | vocabulary_confusion | off_topic | blank",
  "reasoning_pattern": "surface_recall | partial_reasoning | full_reasoning | misconception | creative_extension | blank_or_off_topic",
  "misinterpretation_detected": true | false,
  "vocabulary_difficulty": "none | low | medium | high",
  "cognitive_notes": "1 sentence describing what the response reveals about understanding"
}

Scoring rules:
- 1.0 = correct with adequate reasoning
- 0.5 = partially correct, shows some understanding
- 0.0 = incorrect, irrelevant, or blank

CRITICAL rules for cognitive fields — you MUST always return meaningful values:
- "reasoning_pattern" MUST reflect actual reasoning observed. NEVER return "none" unless response is blank or off-topic. Use "blank_or_off_topic" for those cases instead.
- "cognitive_notes" MUST be a specific observation about THIS student's response — never generic, never empty.
- "error_type" use "none" only when score is 1.0

Reasoning pattern definitions:
- surface_recall: restated facts without explanation
- partial_reasoning: began reasoning but didn't complete it
- full_reasoning: complete understanding with explanation
- misconception: reveals a specific misconception
- creative_extension: went beyond expected answer with valid insight
- blank_or_off_topic: no response or completely irrelevant

INTELIFLOW LANGUAGE (Barb 2026-05-14 Phase 1 — additive, prose-only):
The Inteliflow Strategies and Powers are the grammar of learning in
CORE. When the response shows a recognizable Inteliflow Strategy in
play, reference it ONCE in cognitive_notes. Same for Powers — name one
when it is developing visibly. ONE Strategy or Power reference per
cognitive_notes is enough — ambient grammar, not a checklist. Skip
the reference entirely when no legible thinking move is visible (blank
/ off-topic / surface recall without an identifiable move).

This is ADDITIVE to existing language rules above (RESPONSE-not-STUDENT
framing, forbidden words, blank-response pattern). DO NOT sacrifice
those for vocabulary. DO NOT change scoring based on whether a Strategy
appears — naming is observational, not evaluative.

Strategy options (12 — observable thinking moves):
- Goal First · Knowledge Bridge · Quick Look (learning preparation)
- Text Detective · Question Quest · Explain It (information processing)
- Note Builder · Idea Mapping (organization)
- Idea Exchange · Think-Talk-Share · Comprehension Crew (collaboration)
- Pause & Reflect (metacognition)

Power options (5 — transferable capacities):
- Monitor · Think (Reason / Analyze / Connect) · Research · Communicate · Collaborate

Example cognitive_notes with the vocabulary:
- "Used Explain It well — restated the central idea in own words."
- "Strong Question Quest move — surfaced a deeper question rather than
  answering at the surface."
- "Note Builder approach visible — organized the response around three
  captured key ideas."
- "Communicate Power coming through — laid out the reasoning step by step."
- "Research Power building — pulled specific details from the passage."

Return ONLY the JSON object.`;
}

// ---- 4. LEARNING STYLE CLASSIFICATION ----

export const LEARNING_STYLE_SYSTEM = `You are a learning specialist.
Classify student learning style from behavioral signals only.
NEVER use quiz score to change the mastery band — that is locked.
Return ONLY valid JSON. No markdown, no explanation, no preamble.`;

export function learningStylePrompt(signals: string): string {
  return `Classify this student's learning style from behavioral signals.

Styles: visual | auditory | read_write | kinesthetic | tactile | emerging
- visual: responds to diagrams, charts, color-coding, spatial layout
- auditory: responds to verbal explanation, discussion, rhythm, listening
- read_write: responds to text, annotation, note-taking, written responses
- kinesthetic: responds to whole-body movement, acting out, role-play, gestures
- tactile: responds to hands-on manipulation, building models, sorting objects, touching/arranging
Use "emerging" when data is insufficient, conflicting, or unstable.

Return:
{
  "learning_style": "visual|auditory|read_write|kinesthetic|tactile|emerging",
  "confidence": 0.0-1.0,
  "reasoning": "1-2 sentence explanation based only on signals"
}

SIGNALS:
${signals}

Return ONLY the JSON object.`;
}

// ---- 5. ASSIGNMENT GENERATION ----
// Full 15-profile differentiation: 3 bands × 5 learning styles
// Enforces band reading levels, style task-type minimums,
// Inteliflow strategies, ATL skills, and IB Core Powers per task

export const ASSIGNMENT_SYSTEM = `You are an expert K-12 curriculum designer trained in the Inteliflow Learning Strategy Toolkit, ATL skills, and IB Learner Profile attributes (Core Powers).

Your ONLY job is to generate highly differentiated, personalized assignments.

LOCK #5 (Barb 2026-05-06): homework must FIT the student. This is
where Inteliflow differs from normal EdTech — homework is per-student,
not per-class. Comprehension band mismatch (work calibrated to a
band other than the student's) is a PERSONALIZATION FAILURE, not a
difficulty issue. It overrides every other signal as the worst
regression mode.

ABSOLUTE RULES — violating any of these is a failure:

1. BAND DIFFERENTIATION IS MANDATORY (CRITICAL — band mismatch is the worst regression):
   - reteach: Tasks must repair misunderstanding. Use simple language (Grade 4-5 reading level). Short sentences. No complex analysis. Scaffolded steps. Explicit support. Reading passage = 2 short paragraphs max. Tasks = concrete, guided, structured.
   - grade_level: Tasks must practice and apply understanding. Grade-appropriate language. Mix of recall + application. Reading passage = 3 paragraphs. Tasks = moderate complexity with some independence.
   - advanced: Tasks must push beyond the lesson into analysis, critique, and creation. Rich, complex language. High-order thinking required. Reading passage = 4 paragraphs with nuance. Tasks = open-ended, evaluative, creative.
   Generating Reteach work for a Grade Level student (or Advanced work for a Reteach student) is the rig's hardest gate — never do it.

2. LEARNING STYLE DIFFERENTIATION IS MANDATORY (VARKT model + Barb's canonical modality cues 2026-05-06) — tasks must LOOK different per style:
   - visual: organize, map, diagram, annotate, color-code. MUST include at least 2 such tasks. No pure writing tasks.
   - auditory: discuss, explain verbally, listen and respond, summarize a lab/process aloud. MUST include at least 1 such task. Tasks written as if spoken.
   - read_write: detailed notes, lists, rewrite study guides, annotate readings, organize ideas into outlines, journal their thinking, written summaries, flash cards with definitions, explain ideas in writing. MUST include at least 2 such tasks. No drawing tasks.
   - kinesthetic: manipulate, build, simulate, move, interact. MUST include at least 2 whole-body or movement-based tasks: acting out, role-playing, walking through steps, gesturing, physical demonstration.
   - tactile: manipulate, build, simulate, interact. MUST include at least 2 hands-on manipulation tasks: building models, sorting cards/objects, cutting and arranging, using physical materials, assembling.
   - emerging: Balanced mix — 1 visual, 1 written, 1 discussion-style task (used when learning style not yet determined).

3. EVERY TASK MUST embed a NAMED Inteliflow strategy, a SPECIFIC ATL skill, and a SPECIFIC IB Learner Profile attribute (Core Power). These shape what the student does — not decorative tags.

PATTERN FLAG RESPONSES (when the user-context "PATTERN FLAGS" block is present, adapt task design as follows — flags compose, so a student with multiple flags should see multiple adaptations):

- processing_difficulty → reduce simultaneous demands per task; break multi-step problems into smaller sub-tasks; allow processing time markers in the task structure.
- comprehension_gap → add a worked example before the practice tasks; embed a self-check prompt mid-task ("does this match what you saw in the example?").
- attention_concern → keep tasks shorter; use varied formats within the assignment; add explicit transitions.
- persistent_reteach → vary the modality from prior reteach attempts; use a meaningfully different angle on the concept.
- high_dependency → embed pause-and-try-yourself prompts before offering scaffold; explicitly invite the student to attempt before asking Teli for help.
- help_avoidance → add explicit pause-and-reflect prompts that require the student to acknowledge confusion; lower the barrier to asking for help by suggesting specific question starters.

These responses compose. A student flagged with both processing_difficulty AND help_avoidance should see both sub-task decomposition AND explicit reflection prompts.

When the user-context "Active alerts" block is present, weight task difficulty downward and add scaffolding consistent with the alert's trigger_reason. Alert responses compose with PATTERN FLAG responses — a student with both gets both treatments.

When NO PATTERN FLAGS block AND no alerts block are present in the user context, ignore the conditional sections above — they fire only when the corresponding context blocks appear.

4. READING PASSAGE: Always required. Never generic. Written at band-appropriate reading level. Contains all vocabulary needed. Uses **bold** for key terms.

5. READING PASSAGE MUST CONTAIN ALL REFERENCED CONTENT: If any task says "read the recipe card" the passage MUST contain an actual recipe with specific ingredients and quantities. If a task says "look at the data table" the passage MUST include a text-based data table. If a task says "read the poem" the passage MUST include the poem. The reading passage IS the source material — tasks reference it directly. NEVER write a generic overview and then have tasks reference specific content that doesn't exist in the passage.

6. TASKS must reference specific content from the lesson — never generic instructions like "write about what you learned."

7. The same lesson given to a reteach visual learner vs an advanced read_write learner must produce COMPLETELY DIFFERENT assignments.

8. WRITING QUALITY: students read every task instruction and reading passage verbatim. All task text, passages, and instructions must be written in complete, grammatically correct sentences with correct spelling and punctuation, in the same language as the lesson content. Proofread before returning — a garbled instruction breaks the student's independence the assignment is designed to build. (Band-appropriate reading level per Rule 1 still applies — simple language for reteach is simple, not sloppy.)

COMPREHENSION BAND IS LOCKED — never override it.
Return ONLY valid JSON. No markdown, no explanation, no preamble.
${MATH_FORMAT_DIRECTIVE}`;

export function assignmentPrompt(
  lessonSummary: string,
  band: string,
  style: string,
  studentName: string,
  strategies?: { name: string; what_students_do: string; atl_skills: string[]; ib_learner_profile: string[]; bloom_level: string }[],
  sparkEnabled?: boolean,
  // Tier 4 Phase 2.3 v3 (Barb 2026-05-14): when true the prompt
  // generates a tighter focused-practice set — fewer tasks, smaller
  // scope, same band/style. Triggered by the teacher's Targeted
  // Practice button on /teacher/students/[id]. The intent: "the
  // student is at-band but needs more reps on the area of confusion;
  // give them a small, doable set, not a full assignment."
  targetedPractice?: boolean,
): string {

  const bandProfiles: Record<string, {
    label: string;
    reading_level: string;
    task_complexity: string;
    passage_length: string;
    verb_starters: string;
    forbidden: string;
    tone: string;
    bloom: string;
    atl_focus: string;
    ib_focus: string;
    support_note_required: boolean;
    extension_required: boolean;
  }> = {
    reteach: {
      label: 'SCAFFOLDED RETEACH',
      reading_level: 'Grade 4-5 reading level. Very short sentences. Simple vocabulary. Define every key term immediately when used.',
      task_complexity: 'SIMPLE and GUIDED only. Each task has 1 clear action. No multi-step analysis. No open-ended evaluation. Focus on recall and basic understanding.',
      passage_length: '2 short paragraphs (6-8 sentences total). Simple structure. Each paragraph covers ONE idea only.',
      verb_starters: 'Use task verbs: identify, circle, match, label, list, copy, fill in, find, name, describe in ONE sentence.',
      forbidden: 'NEVER use: analyze, evaluate, critique, compare-contrast, synthesize, argue, justify. These are too complex for reteach.',
      tone: 'Warm, encouraging, supportive. Break everything down into tiny steps.',
      bloom: 'Remember and Understand ONLY.',
      atl_focus: 'ATL Self-management (organization, goal-setting) and Thinking (basic critical thinking for repair).',
      ib_focus: 'IB Core Powers: Reflective (self-assessment of understanding), Principled (honest effort), Balanced (managing challenge without giving up).',
      support_note_required: true,
      extension_required: false,
    },
    grade_level: {
      label: 'STANDARD GRADE LEVEL',
      reading_level: 'Grade-appropriate reading level. Clear, precise sentences. Use key vocabulary in context — define when first introduced.',
      task_complexity: 'MODERATE complexity. Tasks require both recall AND application. Students must explain their thinking. Some tasks have multiple steps.',
      passage_length: '3 paragraphs (10-14 sentences). Structured with intro, key content, and connection to tasks.',
      verb_starters: 'Use task verbs: explain, describe, compare, apply, demonstrate, summarize, organize, illustrate, connect, show how.',
      forbidden: 'NEVER use pure memorization tasks or highly abstract evaluation beyond the lesson scope.',
      tone: 'Confident and clear. Treats student as capable. Sets clear expectations.',
      bloom: 'Understand, Apply, and some Analyze.',
      atl_focus: 'ATL Thinking (critical thinking, transfer) and Communication (expressing understanding clearly).',
      ib_focus: 'IB Core Powers: Knowledgeable (building understanding), Thinkers (applying skills logically), Communicators (expressing ideas clearly).',
      support_note_required: false,
      extension_required: false,
    },
    advanced: {
      label: 'EXTENSION ADVANCED',
      reading_level: 'Grade-above reading level. Complex sentences. Rich vocabulary. Students infer meaning from context.',
      task_complexity: 'HIGH complexity. Tasks require analysis, evaluation, synthesis, and creation. Open-ended questions. Students must justify, defend, critique, or create something original.',
      passage_length: '4 paragraphs (14-18 sentences). Dense, nuanced content with layers of meaning. Includes complexity or tension to analyze.',
      verb_starters: 'Use task verbs: analyze, evaluate, critique, construct, design, argue, defend, compare perspectives, synthesize, predict, propose.',
      forbidden: 'NEVER use simple recall or fill-in tasks. Never ask for a single right answer. Push beyond the lesson.',
      tone: 'Intellectual, challenging, respectful. Treats student as a capable thinker. Invites genuine inquiry.',
      bloom: 'Analyze, Evaluate, and Create.',
      atl_focus: 'ATL Thinking (creative and critical), Communication (presenting complex ideas), Social (collaboration and peer learning).',
      ib_focus: 'IB Core Powers: Inquirers (extending curiosity), Risk-takers (tackling intellectual challenge), Open-minded (considering multiple perspectives), Thinkers.',
      support_note_required: false,
      extension_required: true,
    },
  };

  const styleProfiles: Record<string, {
    label: string;
    task_requirements: string;
    passage_style: string;
    task_format: string;
    constraints: string;
  }> = {
    visual: {
      label: 'VISUAL LEARNER',
      task_requirements: 'MINIMUM 2 tasks must involve drawing, diagramming, labeling, mapping, or creating a visual.',
      passage_style: 'Include rich visual/descriptive language. Describe what things LOOK like, how they are arranged, what their shape/color/structure is.',
      task_format: 'Tasks: "Draw and label...", "Create a concept map showing...", "Sketch a diagram of...", "Color-code the...", "Map the relationship between..."',
      constraints: 'No pure writing-only tasks. Every task should produce something visible.',
    },
    auditory: {
      label: 'AUDITORY LEARNER',
      task_requirements: 'MINIMUM 1 task must involve explaining aloud, recording, discussing, or teaching someone else.',
      passage_style: 'Write as if being spoken. Use rhythm and emphasis. Include phrases like "Notice how...", "Listen for...", "Imagine hearing..."',
      task_format: 'Tasks: "Explain to a partner...", "Record yourself describing...", "Say aloud in your own words...", "Discuss with someone...", "Teach a family member..."',
      constraints: 'Tasks are written as if the student will SPEAK their answer. Conversational language throughout.',
    },
    read_write: {
      label: 'READ/WRITE LEARNER',
      task_requirements: 'MINIMUM 2 tasks must involve structured reading, writing, annotation, note-taking, or responding in paragraph form.',
      passage_style: 'Dense, information-rich text. Well-organized paragraphs. Include specific details, examples, and definitions. Formal but accessible language.',
      task_format: 'Tasks: "Write a paragraph explaining...", "Annotate the passage by...", "Take structured notes on...", "Write a summary of...", "Respond in writing to..."',
      constraints: 'No drawing tasks. All tasks completed through written language.',
    },
    kinesthetic: {
      label: 'KINESTHETIC LEARNER',
      task_requirements: 'MINIMUM 2 tasks must involve whole-body movement: acting out, role-playing, walking through steps, gesturing, physical demonstrations, or simulations.',
      passage_style: 'Use action-oriented language. Describe processes as movements. Use: "Stand up and...", "Walk through...", "Act out...", "Show with your body...". Focus on how things FEEL in motion.',
      task_format: 'Tasks: "Act out the steps of...", "Role-play as...", "Walk through the process of...", "Demonstrate with gestures...", "Simulate what happens when..."',
      constraints: 'Tasks must involve whole-body movement or physical demonstration. No passive sitting tasks.',
    },
    tactile: {
      label: 'TACTILE LEARNER',
      task_requirements: 'MINIMUM 2 tasks must involve hands-on manipulation: building models, sorting objects/cards, cutting and arranging, assembling, using physical materials.',
      passage_style: 'Use concrete, tactile language. Describe textures, sizes, shapes, weights. Use: "Pick up...", "Arrange...", "Feel the difference between...". Focus on what things are MADE of.',
      task_format: 'Tasks: "Build a model of...", "Sort these into groups by...", "Cut out and arrange...", "Use objects to represent...", "Assemble the parts of..."',
      constraints: 'Tasks must produce something the student built, sorted, or arranged with their hands. No pure writing or verbal tasks.',
    },
    // SOCIAL / collaborative learner. `social` is a valid stored
    // learning_style (lib/utils/learningStyle.ts ENUM_ACCEPTED) and has
    // its own collaboration strategies in STYLE_TO_STRATEGIES. Without
    // this profile, a social learner silently fell back to `emerging`
    // (the `|| styleProfiles.emerging` below), so their tasks named
    // collaboration strategies but were shaped as a generic balanced
    // mix. This profile shapes the task FORMAT to match the strategies.
    social: {
      label: 'SOCIAL / COLLABORATIVE LEARNER',
      task_requirements: 'MINIMUM 2 tasks must involve working WITH another person: discussing, debating, interviewing, teaching a peer, or building on someone else\'s idea.',
      passage_style: 'Frame content around people, dialogue, and shared perspectives. Use phrases like "Talk it through with...", "Compare your view with...", "Together, work out...".',
      task_format: 'Tasks: "Discuss with a partner and...", "Interview someone about...", "Debate the question...", "Teach this idea to a classmate...", "Combine your answer with a partner\'s and..."',
      constraints: 'Tasks should involve interaction or a shared product. Avoid purely solo, silent work.',
    },
    emerging: {
      label: 'EMERGING LEARNING STYLE',
      task_requirements: 'Use a BALANCED mix: 1 visual task (draw/map), 1 written task (write/explain), 1 discussion or verbal task.',
      passage_style: 'Clear, accessible language. Mix of descriptive and explanatory content. Not too dense, not too sparse.',
      task_format: 'Mix task types: one drawing task, one writing task, one explanation or sharing task.',
      constraints: 'Do not favor one modality. Keep tasks simple and varied.',
    },
  };

  const bp = bandProfiles[band] || bandProfiles.grade_level;
  const sp = styleProfiles[style] || styleProfiles.emerging;

  const strategyBlock = strategies && strategies.length > 0
    ? `REQUIRED INTELIFLOW STRATEGIES — embed one per task:
${strategies.map((s, i) => `Strategy ${i + 1}: "${s.name}"
  What students do: ${s.what_students_do}
  ATL Skills: ${s.atl_skills.join(', ')}
  IB Core Powers: ${s.ib_learner_profile.join(', ')}
  Bloom's Level: ${s.bloom_level}`).join('\n\n')}

CONSTRAINT: Each task MUST name one of these strategies in its "strategy" field. The task description MUST reflect what that strategy actually has students DO.`
    : `Assign appropriate Inteliflow strategies for this band and style. Each task must name a specific strategy.`;

  return `Generate a HIGHLY DIFFERENTIATED personalized assignment.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STUDENT: ${studentName}
BAND: ${band.toUpperCase()} — ${bp.label}
STYLE: ${style.toUpperCase()} — ${sp.label}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${targetedPractice ? `

═══════════════════════════════════════
TARGETED PRACTICE MODE — TIGHTER SCOPE
═══════════════════════════════════════
This is a TEACHER-INITIATED targeted practice set, NOT a full
assignment. The teacher has identified that ${studentName} is at-
band but needs more reps on a specific area of confusion. Generate
a SHORTER, MORE FOCUSED set:

- 2-3 tasks total (instead of 3-5). The student should be able to
  complete the whole set in 10-15 minutes.
- All tasks zero in on the SAME core skill or concept — no
  scattered coverage. Pick the one most-load-bearing skill from
  the lesson and drill it from 2-3 angles.
- Tone: "let's work on this specific thing together" — not "here's
  another full assignment." The student should feel supported,
  not loaded.
- Keep the SAME band level. Don't drop scaffold; don't bump
  difficulty. This is reps on what they already mostly understand.
- Passage length, diagram fields, audio_script all still required.
  Same standard, just fewer tasks.` : ''}

═══════════════════════════════════════
BAND CONSTRAINTS — NON-NEGOTIABLE
═══════════════════════════════════════
Reading level: ${bp.reading_level}
Task complexity: ${bp.task_complexity}
Passage length: ${bp.passage_length}
Task verb starters to use: ${bp.verb_starters}
FORBIDDEN task types: ${bp.forbidden}
Tone: ${bp.tone}
Bloom's taxonomy: ${bp.bloom}
ATL skill focus: ${bp.atl_focus}
IB Core Powers focus: ${bp.ib_focus}
${bp.support_note_required ? 'support_note: REQUIRED — write a warm encouraging message for this reteach student' : 'support_note: OMIT'}
${bp.extension_required ? 'extension_prompt: REQUIRED — write a challenging extension question that goes beyond the lesson' : 'extension_prompt: OMIT'}

═══════════════════════════════════════
LEARNING STYLE CONSTRAINTS — NON-NEGOTIABLE
═══════════════════════════════════════
Task requirements: ${sp.task_requirements}
Reading passage style: ${sp.passage_style}
Task format guidance: ${sp.task_format}
Additional constraints: ${sp.constraints}

═══════════════════════════════════════
STRATEGY + CORE POWERS CONSTRAINTS — NON-NEGOTIABLE
═══════════════════════════════════════
${strategyBlock}

═══════════════════════════════════════
MEDIA REQUIREMENTS — ALL REQUIRED
═══════════════════════════════════════
reading_passage: Written at ${band} reading level. Style: ${sp.passage_style}. Length: ${bp.passage_length}. Bold ALL key vocabulary with **term** syntax. Specific to lesson content — never generic.
audio_script: Same content as reading_passage but conversational spoken tone. Remove all markdown formatting. Written as if a teacher is reading it aloud to the class.
diagram_mode: Choose "image", "structured", or "none" based on whether a visual genuinely helps for THIS specific assignment. CRITICAL FLOOR: if the student's learning_style is "visual", "kinesthetic", or "tactile", diagram_mode MUST be "image" or "structured" — NEVER "none". These learners depend on visual content; an empty diagram slot is a personalization failure. Find a relevant visual angle even for analytical or literary lessons (a story-arc diagram, a character-relationship map, a setting illustration, a metaphor rendered as a labeled image). For read_write, auditory, and emerging learners, "none" is permitted when text-heavy.
  Use "image" when: the diagram shows something that needs to LOOK real — anatomy, landscapes, objects, organisms, structures, maps, equipment, characters/scenes from a narrative, settings.
  Use "structured" when: the diagram shows a PROCESS, FLOW, SEQUENCE, or HIERARCHY — steps, cycles, cause-effect chains, timelines, decision trees, story arcs, character relationships, plot structures.
  Use "none" ONLY when: learning_style is read_write, auditory, or emerging AND the assignment is text-heavy literary/textual analysis, debate or persuasive writing, philosophical/ethical reasoning, vocabulary/grammar drilling, or foreign-language translation. Even then, prefer a relevant visual when one fits. A fabricated, irrelevant diagram (random objects, abstract shapes) actively harms the assignment — but for visual/kinesthetic/tactile learners, the answer is to find a RELEVANT visual angle, not to skip the diagram.
  Examples: "parts of a plant cell" → "image". "Steps of mitosis" → "structured". "Human heart anatomy" → "image". "Food chain" → "structured". "Rock cycle" → "structured". "Cross-section of a volcano" → "image". "Themes in a short story" with a visual learner → "structured" (theme-evidence map) or "image" (illustrated scene). "Compare prose vs poetry" with a read_write learner → "none" is OK. "Identify metaphors in this stanza" with a visual learner → "image" (the metaphor rendered as a labeled illustration), NOT "none".
diagram_description: 2-3 sentence description of the key diagram or visual for this lesson. What does it show? What should the student be able to identify? Set to null when diagram_mode is "none".
diagram_svg_prompt: Instructions for generating SVG LABEL OVERLAY arrows and numbered markers that will be placed on top of a realistic image. Only used when diagram_mode is "image". Set to null otherwise. Describe which parts to label and where they are located.
diagram_image_prompt: A detailed description of what the realistic educational illustration should show. Only used when diagram_mode is "image". Set to null otherwise. Describe the subject as if commissioning a textbook illustrator. Be specific about colors, orientation, and which parts must be visible. CRITICAL: The image must contain ZERO text — no letters, numbers, labels, or words. Labels are added separately.
youtube_search_query: Specific YouTube search query to find a good educational video for this exact topic and grade level.

═══════════════════════════════════════
SELF-CHECK BEFORE RETURNING
═══════════════════════════════════════
1. Would a reteach student find this assignment significantly simpler than a grade_level version? If not — rewrite.
2. Do the tasks look and feel completely different from a different learning style? If not — rewrite.
3. Does every task name a specific Inteliflow strategy that shapes what the student does? If not — rewrite.
4. Does every task have a specific ATL skill and IB Core Power earned by doing the task? If not — rewrite.
5. reading_passage, audio_script, and youtube_search_query MUST be present and non-empty. The diagram fields are CONDITIONAL on diagram_mode:
   - If diagram_mode is "image": diagram_description, diagram_svg_prompt, AND diagram_image_prompt must all be present and non-empty.
   - If diagram_mode is "structured": diagram_description must be present and non-empty; diagram_svg_prompt and diagram_image_prompt should be null.
   - If diagram_mode is "none": all three diagram fields must be null. Do NOT fabricate a diagram. Do NOT invent unrelated visual content. Do NOT fall back to abstract shapes or generic objects to fill the slot.
6. NO-DIAGRAM CONSISTENCY — CRITICAL: If you set diagram_mode to "none", verify NO task references a diagram, image, chart, illustration, or visual. If any task says "look at the diagram", "study the image", "use the chart", you must either (a) flip diagram_mode to "image" or "structured" and supply a relevant prompt, or (b) rewrite the task to not reference a visual. A "none" mode with a task that says "look at the diagram" is BROKEN.

6b. VISUAL-LEARNER FLOOR — CRITICAL: If learning_style is "visual", "kinesthetic", or "tactile", diagram_mode MUST be "image" or "structured" — NEVER "none". Find a relevant visual angle. For analytical or literary lessons, valid angles include: a story-arc / plot-structure diagram (structured), a character-relationship map (structured), a scene illustration (image), a metaphor rendered as a literal+figurative side-by-side image (image), a vocabulary word visualized in context (image), a thinking-flow showing how to approach the analysis (structured). The visual is for learning support — not decoration. If you cannot think of a relevant visual for the lesson + learner combination, you have not thought hard enough about it. Try again before downgrading to "none".
7. PASSAGE-TASK CONSISTENCY — CRITICAL: Read every task description. If any task references a recipe, chart, poem, data set, letter, article, or any specific document — that EXACT content MUST appear in the reading_passage. If the passage doesn't contain it, either add it to the passage or rewrite the task to reference what the passage actually contains.

7b. PASSAGE-TASK ANALYTICAL ALIGNMENT — CRITICAL (catches expository-passage / apply-the-tool mismatch): When a task asks the student to APPLY a literary or analytical tool to "this passage" — examples: "identify two themes in the passage," "find metaphors in the passage," "analyze the character development," "infer the tone," "describe the mood," "identify foreshadowing," "compare the protagonist and antagonist," "analyze how the setting affects the plot" — the reading_passage MUST be the kind of text that contains those elements. A NARRATIVE (story, poem, primary source, scene, dialogue, excerpt with characters and events) supports apply-the-tool tasks. An EXPOSITORY/DEFINITIONAL passage ("a theme is the central idea...", "metaphors are figures of speech that...") describes the TOOL — it does NOT contain the tool's instances and CANNOT be the subject of an apply-the-tool task. The task would be unanswerable from the passage as written.

  When this mismatch is detected, STRONGLY PREFER option (a) — rewrite the reading_passage as a short narrative excerpt with characters/events/dialogue that legitimately contains the literary elements the tasks ask about. The passage can still introduce the concept briefly, but the BULK of it must be the example narrative. This keeps the diagram path alive for visual/kinesthetic/tactile learners and produces a richer assignment.

  Option (b) — rewriting tasks so they don't reference "this passage" — is a fallback only when (a) is genuinely impossible (e.g., the lesson is purely meta-analytic). Even with option (b), DO NOT downgrade diagram_mode to "none" as a side-effect — you can still illustrate the concept itself (e.g., a labeled image showing what a metaphor IS, with the figurative and literal sides drawn).

  This rule is most often violated for introductory-concept lessons (themes, metaphors, character development, point of view, tone, mood, irony, symbolism, allegory). The lesson is ABOUT the concept; the passage explains the concept; the tasks then incorrectly ask the student to find instances of the concept IN the explanation. That is a broken assignment. Catch it here — but do NOT use this rule as an excuse to skip diagrams.
8. MEDIA CONSISTENCY — CRITICAL (only applies when diagram_mode is "image" or "structured"):
   - If ANY task says "look at the diagram/image/chart" or "label the diagram", the diagram_svg_prompt MUST describe that EXACT subject realistically (e.g., for photosynthesis: "Draw a plant with roots in soil, green stem, leaves with labeled stomata, arrows showing sunlight from above, water arrows from roots, CO2 arrows entering leaves, O2 arrows leaving"). NEVER use abstract shapes for real subjects. NEVER use random objects (lizards, light bulbs, elephants, shells, etc.) as filler when you can't think of a relevant visual — instead set diagram_mode to "none".
   - The diagram_svg_prompt must match the task description EXACTLY. If the task says "label the parts of a plant", the diagram must show an actual plant with parts to label.
   - If a task says "watch the video", the youtube_search_query MUST match that specific topic.
   - Tasks must NEVER reference media that isn't provided in the JSON.

Return this exact JSON:
{
  "title": "Assignment title specific to the lesson and band",
  "mode": "${band === 'reteach' ? 'scaffolded' : band === 'advanced' ? 'extension' : 'standard'}",
  "learning_style": "${style}",
  "reading_passage": "Full passage at ${band} reading level with **bolded** key terms — ${bp.passage_length}",
  "audio_script": "Conversational spoken version of the passage — no markdown formatting",
  "diagram_mode": "image | structured | none — pick 'none' for text-heavy literary/writing/debate/translation tasks where a diagram would be decorative not instructional",
  "diagram_description": "Description of the key visual — REQUIRED when diagram_mode is image or structured, MUST be null when diagram_mode is none",
  "diagram_svg_prompt": "SVG label overlay instructions — REQUIRED when diagram_mode is image, MUST be null otherwise",
  "diagram_image_prompt": "Detailed realistic illustration description — REQUIRED when diagram_mode is image, MUST be null otherwise. NO TEXT in the image.",
  "youtube_search_query": "Specific search query for educational video on this topic",
  "instructions": "1-2 sentence overview written for a ${band} ${style} learner",
  "tasks": [
    {
      "step": 1,
      "description": "Specific task tied to lesson content — reflects ${band} band complexity and ${style} style modality",
      "type": "read|write|draw|discuss|create|analyze",
      "strategy": "Named Inteliflow strategy used in this task",
      "atl_skill": "Specific ATL skill category practiced",
      "ib_attribute": "Specific IB Learner Profile attribute (Core Power) practiced",
      "bloom_level": "Bloom's taxonomy level"
    }
  ],
  ${bp.support_note_required ? '"support_note": "Warm encouraging message for this reteach student",' : ''}
  ${bp.extension_required ? '"extension_prompt": "Challenging extension question for this advanced student",' : ''}
  "atl_summary": ["ATL skill 1", "ATL skill 2"],
  "ib_attributes": ["IB Core Power 1", "IB Core Power 2"]
}

RULES:
- ${targetedPractice ? '2-3 tasks total — TIGHTER FOCUSED PRACTICE SET, NOT a full assignment' : '3-5 tasks total'}
- All tasks specific to THIS lesson content — never generic
- reading_passage and audio_script are MANDATORY — never omit
- Return ONLY the JSON object${sparkEnabled ? `

SPARK CHALLENGE — PARALLEL TO HOMEWORK (do NOT emit as a task):
This school has Spark (Inteliflow's interactive learning platform) enabled, and a
SEPARATE Spark Challenge will be generated for this lesson alongside this homework
assignment. The Spark Challenge is rubric-evaluated (7 dimensions, 1-4 scale) and
lives outside the gradebook — distinct from CORE-graded homework. The student sees
two parallel surfaces: this homework AND the Spark Challenge.

What this means for the homework you generate here:
- Do NOT emit any task with type "spark_experience". That type does not exist in
  this output schema. The valid task types are exactly: read, write, draw, discuss,
  create, analyze.
- Generate all 3-5 homework tasks using only the standard task types —
  including for kinesthetic, tactile, and visual learners. Their interactive
  enrichment lives in the parallel Spark Challenge, not inside the homework task list.
- Focus your homework on the ${style} learner's modality through the standard task
  surface (e.g., visual learners get rich diagram + draw tasks; kinesthetic learners
  get hands-on create / build tasks; etc.). The Spark Challenge handles the
  simulation / hardware / drag-and-drop modalities separately.

Pedagogical lock: Spark is enrichment. Total student work = N homework tasks
+ 1 Spark Challenge. SPARK is never a substitute for a homework task.` : ''}

LESSON CONTENT:
${lessonSummary}`;
}
