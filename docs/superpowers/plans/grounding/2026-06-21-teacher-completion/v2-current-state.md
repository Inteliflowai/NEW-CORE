# V2 Teacher App Current State — Grounding

**Date:** 2026-06-21
**Scope:** Gradebook, Alerts, Insights, High-Fives stub screens + available data patterns, loaders, and shared surface components.

---

## 4 Teacher Screen Stubs (Routes)

All four screens are currently **10-line EmptyState stubs** under src/app/(teacher)/:

### 1. Gradebook (/gradebook)
**File:** src/app/(teacher)/gradebook/page.tsx (lines 1–10)
\\\	sx
import { EmptyState } from '@/components/core/EmptyState';

export default function GradebookPage() {
  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">Gradebook</h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
\\\

### 2. Alerts (/alerts)
**File:** src/app/(teacher)/alerts/page.tsx (lines 1–10)
\\\	sx
import { EmptyState } from '@/components/core/EmptyState';

export default function AlertsPage() {
  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">Alerts</h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
\\\

### 3. Insights (/insights)
**File:** src/app/(teacher)/insights/page.tsx (lines 1–10)
\\\	sx
import { EmptyState } from '@/components/core/EmptyState';

export default function InsightsPage() {
  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">Insights</h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
\\\

### 4. High-Fives (/high-fives)
**File:** src/app/(teacher)/high-fives/page.tsx (lines 1–10)
\\\	sx
import { EmptyState } from '@/components/core/EmptyState';

export default function HighFivesPage() {
  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">High Fives</h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
\\\

---

## Teacher App Shell & Navigation

### TeacherShell (Layout Wrapper)
**File:** src/app/(teacher)/_components/TeacherShell.tsx
**Key details:**
- \data-role="teacher"\ + \data-intensity="calm"\ — token binding for role-specific styling
- Persistent sidebar rail on \lg:\ breakpoint (display:none below)
- Mobile drawer mounts only when \open===true\ (keeps closed controls out of a11y tree)
- Main column structure: \TeacherTopbar\ + scrollable \main.pop-canvas\

### TeacherLayout (Route Group)
**File:** src/app/(teacher)/layout.tsx
**Auth chain:** \equireRole(['teacher'])\ gate → \TeacherShell\ with \userName\

### Navigation Config (Single Source of Truth)
**File:** src/app/(teacher)/_components/navConfig.ts

The nav is in CLASS/LIBRARY/INSIGHTS & TOOLS groups with support for badges (alerts).

---

## Built Teacher Surfaces (Patterns to Reuse)

### 1. Today Page (\/today\)
**File:** src/app/(teacher)/today/page.tsx
**Pattern:** Server Component, class-scoped, default-to-first-class redirect

**Rendered surfaces:**
- \PageHeader\ (kicker + title + accent sticker)
- \SummaryCallout\ (at-a-glance sentence)
- \NeedsYouCard\ (top-3 focus group in a grid)
- \WinsCard\ (advanced-band students, on-track count)
- \QuickStartCard\ (action CTA)
- \ConceptGapsRail\ (class-wide gaps, conditionally shown if present)

### 2. Roster Page (\/roster\)
**File:** src/app/(teacher)/roster/page.tsx
**Pattern:** Same server-side auth chain; extended triage surface

**Rendered surfaces:**
- \PageHeader\ + \SummaryCallout\
- \ClassPulseStrip\ (band distribution dots)
- Full focus group cards (>6 capped + overflow note)
  - Each \RosterTriageCard\ shows severity dots, action chip, humanized why, risk badge, volatility
- \EveryoneElseDisclosure\ (collapsed by default)
- \ConceptGapsRail\ (always present)
- \SignalLegend\

---

## Data Loaders & Signals Layer

### loadRosterSignals
**File:** \src/lib/signals/loadRosterSignals.ts\ (lines 64–287)

**Returns:** 
- \oster: RosterItem[]\ — All enrolled (band, volatile, risk)
- \ocus_group: FocusGroupItem[]\ — Needs you flagged students
- \concept_gaps: ConceptGapItem[]\ — Class-wide skill hotspots

**Key fields on each item:**
- RosterItem: band (null | 'reteach' | 'grade_level' | 'advanced'), volatile, risk { risk_level, risk_factors[] }
- FocusGroupItem: diagnosis { suggestedAction, severity }, divergence_score, hw_avg, quiz_avg (TEACHER-ONLY numbers)
- ConceptGapItem: skill_name, pct_incorrect (% of class got it wrong)

**Data sources queried:**
- enrollments + users (active students)
- quiz_attempts (10 most recent; mastery_band, score_pct)
- homework_attempts (10 most recent; score_pct, redo flags)
- misconception_observations (student + skill + error_type)
- skills (resolve opaque skill_id → display name)

---

### loadStudentSignals
**File:** \src/lib/signals/loadStudentSignals.ts\ (lines 90–322)

**Returns:** One-student full signal bundle for drill-in:
- per_skill_cl: CL verb per skill (state + confidence_label)
- recurring_misconceptions: Errors grouped by skill
- divergence: hw vs quiz + flagged boolean (>= 20)
- effort: dominant_effort_pattern
- risk: { roster, session }
- reteach_outcomes: Completed redo cycles
- trajectory: consistency + trend
- growth_history: Snapshot scores
- coach_read: ONE observation (exceptions-first, >= 2 sessions)

---

## Copy Helpers & Leak Guards

### Leak Guard (\src/lib/copy/leakGuard.ts\)
**Exports:**
- \hasLeak(text): boolean\ — True if text has numeric/stat pattern
- \ssertNoLeak(text, ctx?): void\ — Throws if leak found
- \BANNED_WORDS: string[]\ — Banned coach-posture jargon
- \hasBannedWord(text): boolean\

**Leak patterns:** bare digit, %, avg, percentile, rank, ordinals, score <number>
**Banned words:** score, percentile, index, divergence, threshold, signal, model, algorithm, flag
*(Note: risk is NOT banned — it appears in established teacher copy)*

### Humanized Copy Functions

| Function | Purpose | Notes |
|----------|---------|-------|
| \	riageWhySentence\ | Humanized why (teacher-only) | Keeps numbers, says "Assignment" not "HW" |
| \diagnosisToFeedSentence\ | Leak-free feed line (audience-safe) | No numbers |
| \iskFactorPhrase\ | Sanitizer for raw risk factors | Strips numeric tails |
| \divergencePhrase\ | HW↔quiz gap explanation (teacher-only) | Keeps numbers |
| \coachObservation\ | EMA model → one plain observation | Speaks only when pattern detected, >= 2 sessions |

### Coach Observation (\src/lib/copy/coachObservation.ts\)
**Posture:**
- Speaks only when a real coach would (rushing, drifting, coasting, careless)
- Silent until >= 2 sessions of data (the voice is "the last few quizzes", not one bad day)
- Risk-flagged students (high/critical) surface a "Worth a closer look" card even in cold-start
- Numbers + banned words never appear in output

---

## Shared Component Kit

**File:** \src/components/core/\

| Component | Props | Purpose |
|-----------|-------|---------|
| Card | children, className, tone | Content surface + Pop-Art chrome |
| PageHeader | title, kicker, accent, action | Page title + accent sticker |
| SummaryCallout | children | Class summary sentence strip |
| MasteryLabel | band | Colored band badge |
| RiskBadge | band | Risk indicator (medium/high/critical) |
| CLBadge | verb | CL verb badge |
| EmptyState | variant, titleOverride, bodyOverride | No-data fallback |
| GrowthMotif | accent | Growth/trajectory placeholder (cold-start safe) |

**Icons:** IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive, IconLessons, IconQuizzes, IconInsights, IconUpload, IconBolt

---

## Database Tables for These Screens

### homework_attempts
- score_pct, teli_hint_count, submitted_at
- allow_redo, is_redo (redo flags)
- effort_label (CHECK: effortful_success | struggling_trying | independent_success | independent_struggle)
- flagged_by (auto | teacher | null)

### quiz_attempts
- mastery_band, score_pct, submitted_at, is_complete

### misconception_observations
- student_id, skill_id, error_type, observed_at
- Index: idx_mo_student_skill_error

### misconception_types (Reference Vocabulary — 14 rows)
- error_type (8): none, factual_error, reasoning_gap, incomplete, misunderstood_question, vocabulary_confusion, off_topic, blank
- reasoning_pattern (6): surface_recall, partial_reasoning, full_reasoning, misconception, creative_extension, blank_or_off_topic

### skill_learning_state
- student_id, skill_id, state, confidence

### student_model_snapshots
- snapshot_date, avg_score, consistency_score

### behavioral_signals
- student_id, computed (jsonb EMA), observation_count

---

## Data Available Today vs Missing

### Gradebook
**Could render:** Roster + homework_attempts.score_pct, assignment names/dates, per-student aggregates, filter/sort
**Missing:** Dedicated gradebook table, attendance/participation tracking, feedback text field

### Alerts
**Could render:** Risk-level flagged students, specific risk factors (sanitized), recurring misconceptions, flagged homework, volatile bands
**Missing:** Dedicated alerts table, dismissal tracking, alert configuration per teacher

### Insights
**Could render:** Misconception hotspots (pct_incorrect), class trajectory, effort distribution, reteach effectiveness, consistency patterns
**Missing:** Pre-computed insights, cohort comparison, trend detection, custom report builder

### High-Fives
**Could render:** Advanced-band students, upward trajectory, improved effort, completed reteach cycles with improvement, streaks
**Missing:** Achievement table, celebration thresholds, milestone tracking, peer comparison safety

---

## Key Constraints & Disciplines

### Four-Audience Leak Guard
- **Teacher sees:** CL verbs, diagnosis, divergence, misconceptions, risk level, band
- **Teacher-only (triage/gradebook/roster):** Raw scores, divergence_score, hw_avg, quiz_avg
- **Students/parents never see:** band enum, raw risk_score, pct_incorrect%, ordinals/percentiles
- **All surfaces:** Token-bound only (no hardcoded hex, no arbitrary radius/shadow)

### Coach Posture
- Observation not metric
- One thing at a time
- Plain language (no jargon: no "signal", "model", "algorithm", "threshold", "index")
- Quiet on good days
- Not a chatbot

### Leak Guards at Copy Boundary
- \leakGuard.ts\: \hasLeak()\, \ssertNoLeak()\, \BANNED_WORDS\, \hasBannedWord()\
- Every render function asserts no leak or sanitizes
- \iskFactorPhrase()\ defensively strips numeric tails

### WCAG-AA Token-Only UI
- Accent stickers (decorative) → contrast not enforced
- All content: \	ext-fg\ or \	ext-fg-on-brand\ (validated pairs)
- Intensity tokens rebind --radius/--shadow via \data-intensity\
- Pop-Art chrome: \order-sidebar-edge\ + \shadow-sticker\

---

## Key File Paths

| File | Purpose |
|------|---------|
| src/app/(teacher)/layout.tsx | Auth gate + TeacherShell |
| src/app/(teacher)/_components/TeacherShell.tsx | App shell |
| src/app/(teacher)/_components/navConfig.ts | Nav entries |
| src/app/(teacher)/today/page.tsx | Working example |
| src/app/(teacher)/roster/page.tsx | Working example |
| src/lib/signals/loadRosterSignals.ts | Class signals loader |
| src/lib/signals/loadStudentSignals.ts | Student signals loader |
| src/lib/copy/leakGuard.ts | Leak validators |
| src/lib/copy/coachObservation.ts | EMA → observation |
| src/lib/copy/triageWhySentence.ts | Humanized why |
| src/lib/copy/riskFactorPhrase.ts | Sanitizer |
| src/components/core/Card.tsx | Card surface |
| src/components/core/PageHeader.tsx | Page header |
| supabase/migrations/0011_signals.sql | Schema: signals + homework |
| supabase/migrations/0013_quiz_runner.sql | Schema: behavioral_signals |
