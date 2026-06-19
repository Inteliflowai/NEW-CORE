# Grounding: Copy Helpers & Signals Libraries
# Plan: CORE V2 P4b — Teacher IA
# Grounded: 2026-06-19

This file captures verbatim facts about the existing copy helpers and signals
libraries that p4b tasks depend on. All line numbers reference files as they
existed at grounding time.

---

## 1. Copy Helpers Pattern (src/lib/copy/)

### Established pattern (both files)

- Pure functions — zero side effects.
- No imports from Next.js (`next/server`, `next/navigation`, etc.) or Supabase.
- Single named export (the function); supporting types/constants exported alongside.
- File-level comment block naming SCOPE §§ and "Pure + import-safe" explicitly.

---

### src/lib/copy/riskBandLabel.ts

**Exported type:**
```ts
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';
```

**Exported function signature:**
```ts
export function riskBandLabel(
  score: number,
  scale: '0to1' | '0to100' = '0to100',
): RiskBand
```

**Band boundaries (0–100 normalised space):**
- `< 25`  → `'low'`
- `< 50`  → `'medium'`
- `< 75`  → `'high'`
- `>= 75` → `'critical'`

**Scale normalisation:** `'0to1'` input is multiplied ×100 before banding.

---

### src/lib/copy/topicFrame.ts

**Exported function signature:**
```ts
export function topicFrame(topic: string): string
```

**Output format (verbatim):** `` `still building: ${toTitleCase(topic.trim())}` ``

- Title-cases every word of the trimmed topic.
- Never uses the word "struggle" in output.
- `toTitleCase` is an unexported internal helper.

---

## 2. src/lib/signals/diagnosis.ts — Full Capture

### Exported constants
```ts
export const RECURRING_ERROR_THRESHOLD = 3;
export const SURFACING_THRESHOLD = 20;
```

### Internal thresholds (not exported)
```ts
const DIVERGENCE_THRESHOLD = 25;
const LOW_HW    = 50;
const OK_QUIZ   = 60;
const LOW_QUIZ  = 50;
```

### DiagnoseInput interface
```ts
export interface DiagnoseInput {
  divergence_score: number;   // 0-100
  hw_avg: number | null;      // 0-100; null = no data
  quiz_avg: number | null;    // 0-100; null = no data
  error_types: string[];      // recent error_type strings (duplicates kept)
}
```

### DiagnoseResult interface — EXACT return type
```ts
export interface DiagnoseResult {
  suggestedAction: 'reteach' | 'practice' | 'verbal_check' | 'profile' | 'monitor';
  severity: 1 | 2 | 3;
  diagnosis: string;
}
```

`diagnose()` returns `DiagnoseResult | null` (null = nothing actionable, suppress surfacing).

### suggestedAction values (exhaustive, first-match pattern table)
| Priority | Condition | suggestedAction | severity |
|----------|-----------|-----------------|----------|
| 1 | divergence >= 25 AND hw_avg < 50 AND quiz_avg >= 60 | `'verbal_check'` | 2 |
| 2 | divergence >= 25 AND quiz_avg < 50 | `'reteach'` | 3 |
| 3 | divergence >= 25 (generic) | `'profile'` | 1 |
| 4 | recurring error type (>= 3 occurrences) | `'practice'` | 2 |
| 5 | divergence >= 20 AND < 25 | `'monitor'` | 1 |
| 6 | otherwise | `null` | — |

### Verbatim diagnosis strings (the "leak" strings that diagnosisToFeedSentence must replace)

**Line 86–87 (pattern 1 — verbal_check):**
```ts
diagnosis: `HW avg ${Math.round(hw_avg)}% diverges from quiz avg ${Math.round(quiz_avg)}% — consider a verbal check.`,
```

**Line 94–95 (pattern 2 — reteach):**
```ts
diagnosis: `Quiz avg ${Math.round(quiz_avg)}% with divergence score ${Math.round(divergence_score)} — concept likely needs reteaching.`,
```

**Line 103–104 (pattern 3 — profile):**
```ts
diagnosis: `Divergence score ${Math.round(divergence_score)} — check student profile for context.`,
```

**Line 113–115 (pattern 4 — practice):**
```ts
diagnosis: `Recurring "${recurring.type}" errors (x${recurring.count}) — targeted practice recommended.`,
```

**Line 122–124 (pattern 5 — monitor):**
```ts
diagnosis: `HW/quiz gap of ${Math.round(divergence_score)} pts — worth monitoring`,
```

These five strings interpolate raw numbers (percentages, divergence scores, counts)
directly into teacher-facing copy. The spec's `diagnosisToFeedSentence` helper is
intended to replace or reformat these for the feed surface — it must handle all five
`suggestedAction` values plus the `null` case.

---

## 3. src/lib/signals/consistency.ts

### Exports
```ts
export type ConsistencyLabel = 'consistent' | 'variable' | 'erratic';
export type TrajectoryDirection = 'improving' | 'stable' | 'worsening';

export interface ConsistencyResult {
  consistency_score: number | null;
  consistency_label: ConsistencyLabel | null;
}

export interface TrajectoryResult {
  trajectory: TrajectoryDirection;
}
```

### computeConsistency
```ts
export function computeConsistency(quizScorePcts: number[]): ConsistencyResult
```
- Cold-start guard: returns `{ consistency_score: null, consistency_label: null }` when `quizScorePcts.length < 3`.
- Caller passes last-5 quiz `score_pct` values.

### computeTrajectory — EXACT signature
```ts
export function computeTrajectory(
  history: number[],
  lowerIsBetter = true,
): TrajectoryResult
```

**CRITICAL DEFAULT:** `lowerIsBetter` defaults to `true` (V1 default preserved per binding correction P3-C6).

- `lowerIsBetter = true`: a DROP in values is `'improving'` (e.g. risk score callers).
- `lowerIsBetter = false`: a RISE in values is `'improving'` — **quiz-score callers MUST pass this explicitly**.
- Cold-start guard: returns `{ trajectory: 'stable' }` when `history.length < 4`.
- Compares `recent` (last 3) vs `older` (positions -6 to -3); returns `'stable'` if `older` is empty.
- Change threshold: `Math.abs(delta) < 0.1` → `'stable'`.

---

## 4. src/lib/signals/computeReteachEffectiveness.ts

### detectCompletedReteachCycles — EXACT signature
```ts
export function detectCompletedReteachCycles(
  attempts: HomeworkAttemptRow[],
  existingCyclePairs: Set<string>
): ReteachCycleRecord[]
```

**HomeworkAttemptRow interface:**
```ts
export interface HomeworkAttemptRow {
  id: string;
  student_id: string;
  assignment_id: string;
  score: number | null;
  allow_redo: boolean;
  is_redo: boolean;
  flagged_by: 'auto' | 'teacher' | null;
  submitted_at: string | null;
  created_at: string;
}
```

Note: **no `class_id` column** on `HomeworkAttemptRow` (C18 correction — removed; class scoping is a caller concern).

**ReteachCycleRecord interface:**
```ts
export interface ReteachCycleRecord {
  student_id: string;
  assignment_id: string;
  original_attempt_id: string;
  redo_attempt_id: string;
  pre_score: number;
  post_score: number;
  improvement: number;     // post - pre (can be negative)
  flagged_by: 'auto' | 'teacher';
  completed_at: string;    // redo submitted_at
}
```

`existingCyclePairs`: a `Set<string>` of `"originalId:redoId"` strings already in `reteach_cycles` (dedup guard).

### aggregateReteachStats — EXACT signature
```ts
export function aggregateReteachStats(
  cycles: Pick<ReteachCycleRecord, 'pre_score' | 'post_score' | 'improvement' | 'flagged_by'>[]
): ReteachEffectivenessStats
```

**ReteachEffectivenessStats interface:**
```ts
export interface ReteachEffectivenessStats {
  total_cycles: number;
  avg_improvement: number;
  success_rate: number;       // % of cycles with improvement > 0
  avg_pre_score: number;
  avg_post_score: number;
  by_flagged_by: {
    auto: { count: number; avg_improvement: number };
    teacher: { count: number; avg_improvement: number };
  };
}
```

All numeric fields are `Math.round()`-ed. Returns zero-struct for empty input.

---

## 5. src/lib/signals/conceptGapDetector.ts

### detectConceptGaps — EXACT signature
```ts
export function detectConceptGaps(data: ConceptGapInput): ConceptGapResult[]
```

**ConceptGapInput interface:**
```ts
export interface ConceptGapInput {
  questions: {
    questionIndex: number;
    questionText: string;
  }[];
  responses: {
    studentId: string;
    questionIndex: number;
    isCorrect: boolean;
  }[];
}
```

**ConceptGapResult interface:**
```ts
export interface ConceptGapResult {
  question_index: number;
  question_text: string;
  pct_incorrect: number;
}
```

**Exported constants:**
```ts
export const THRESHOLD_PCT = 40;   // minimum % incorrect to flag as gap
export const MIN_STUDENTS  = 5;    // minimum attempts per question
```

Gap detection math (verbatim from V1):
```ts
const pct = Math.round((stats.incorrect / stats.total) * 100);
if (pct >= THRESHOLD_PCT) { /* flag */ }
```

Pure function — no DB calls, no AI calls, no Next.js imports.
Caller is responsible for generating reteach suggestions and persisting to `concept_gaps`.

---

## 6. src/lib/utils/masteryLabel.ts

### masteryDisplayLabel — EXACT signature
```ts
export function masteryDisplayLabel(band: string | null | undefined): string
```

**Band map (exhaustive):**
```ts
const BAND_LABELS: Record<string, string> = {
  reteach: 'Building',
  grade_level: 'On Track',
  advanced: 'Strong',
};
```

- `null` / `undefined` / unknown string → `'Not yet assessed'`
- Pure + import-safe (no Next.js / Supabase imports).
- SCOPE §15: never exposes raw enum values (`'reteach'`/`'grade_level'`/`'advanced'`) to students.

**Note on naming:** The exported function is `masteryDisplayLabel`, NOT `masteryLabel`.
Any spec or plan that references `masteryLabel(...)` as the function name is incorrect.
