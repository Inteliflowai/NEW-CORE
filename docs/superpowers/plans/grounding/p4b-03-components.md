# p4b-03-components — Grounding: Four Component Tweaks + Signals Route

Grounded: 2026-06-19
Source files read verbatim at the line numbers shown.

---

## 1. RiskBadge — `src/components/core/RiskBadge.tsx`

### Props interface (lines 11–14)

```ts
export interface RiskBadgeProps {
  score: number;
  scale?: '0to1' | '0to100';
}
```

### RiskBand type (line 9 — imported, not defined locally)

```ts
import { riskBandLabel, type RiskBand } from '@/lib/copy/riskBandLabel';
```

`RiskBand` is **imported from `@/lib/copy/riskBandLabel`**, not defined inside this file.
The local file does not contain a `type RiskBand = ...` declaration.

### riskBandLabel call (line 33)

```ts
const band = riskBandLabel(score, scale);
```

### How it renders — numeric score suppression (lines 35–46)

```tsx
return (
  <span
    role="status"
    aria-label={`Risk level: ${band}`}
    className={[
      'inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium',
      BAND_STYLES[band],
    ].join(' ')}
  >
    {band}
  </span>
);
```

- The `aria-label` is `Risk level: ${band}` — the band string only, NOT the numeric score.
- The only child node is `{band}` — the string, never the number.
- `score` is passed to `riskBandLabel` and then discarded; it does NOT appear anywhere in the JSX, in any data attribute, or in any aria attribute.
- **The numeric score never enters the DOM and never appears in an aria-label.** Confirmed.

### BAND_STYLES map (lines 20–25)

```ts
const BAND_STYLES: Record<RiskBand, string> = {
  low:      'bg-ok-surface   text-ok-fg',
  medium:   'bg-warn-surface text-warn-fg',
  high:     'bg-risk-surface text-risk-fg',
  critical: 'bg-risk-surface text-risk-fg ring-2 ring-risk',
};
```

---

## 2. CLBadge — `src/components/core/CLBadge.tsx`

### Props interface (lines 21–29)

```ts
export interface CLBadgeProps {
  /** The skill learning state from the DB enum. */
  state: SkillLearningState;
  /**
   * Confidence score (0–100). Rendered as a soft word only — the raw number
   * NEVER appears in the DOM. Pass null or omit to suppress confidence display.
   */
  confidence?: number | null;
}
```

### ConfidenceWord type (line 31) — NOT exported

```ts
type ConfidenceWord = 'consistent' | 'tentative' | 'emerging';
```

**`ConfidenceWord` is a module-private type; it is NOT exported.**

### toConfidenceWord function (lines 34–38)

```ts
/** Maps a numeric confidence to a soft word. Raw number never exposed. */
function toConfidenceWord(confidence: number): ConfidenceWord {
  if (confidence >= 70) return 'consistent';
  if (confidence >= 40) return 'tentative';
  return 'emerging';
}
```

### toConfidenceWord usage (lines 64–67)

```ts
const word: ConfidenceWord | null =
  verb !== null && typeof confidence === 'number' && confidence !== null
    ? toConfidenceWord(confidence)
    : null;
```

Only called when `verb !== null` (i.e. state has an active CL verb) AND `confidence` is a non-null number.

### SkillLearningState type (line 18 — imported, not defined locally)

```ts
import {
  CL_VERB_BY_STATE,
  type SkillLearningState,
} from '@/lib/skills/clVerbs';
```

`SkillLearningState` is **imported from `@/lib/skills/clVerbs`**, not defined in this file.

---

## 3. EmptyState — `src/components/core/EmptyState.tsx`

### Props interface (lines 49–52)

```ts
interface EmptyStateProps {
  variant: EmptyStateVariant;
  className?: string;
}
```

Note: `EmptyStateProps` is NOT exported (lowercase `interface`, no `export`).

### EmptyStateVariant type (lines 26–29) — IS exported

```ts
export type EmptyStateVariant =
  | 'not-yet-assessed'
  | 'just-getting-started'
  | 'on-track';
```

### COPY map (lines 31–47) — keys and full shape

```ts
const COPY: Record<EmptyStateVariant, { heading: string; body: string; icon: string }> = {
  'not-yet-assessed': {
    icon: '○',
    heading: 'Not yet assessed',
    body: 'Data will appear once practice is complete.',
  },
  'just-getting-started': {
    icon: '◇',
    heading: 'Just getting started',
    body: 'Keep going — more practice builds a clearer picture.',
  },
  'on-track': {
    icon: '◆',
    heading: "You're on track",
    body: 'Things look good here. Keep going.',
  },
};
```

Each entry shape: `{ icon: string; heading: string; body: string }`.

### Body text with text-fg-muted class — EXACT line (line 63)

```tsx
<p className="text-fg-muted text-base leading-relaxed max-w-[28ch] mx-auto">{body}</p>
```

**Line 63.** The `<p>` element with `text-fg-muted` is the body text renderer.
Full class string: `"text-fg-muted text-base leading-relaxed max-w-[28ch] mx-auto"`.

---

## 4. GrowthMotif — `src/components/core/GrowthMotif.tsx`

### Props interface (lines 7–12)

```ts
interface GrowthMotifProps {
  /** Ordered history of scores (oldest first). Must have ≥4 points to render bars. */
  history: number[];
  /** Optional copy shown below the bars (e.g. "+18 pts vs 4 weeks ago"). */
  deltaLabel?: string;
}
```

Props are `history: number[]` and optional `deltaLabel?: string`. No `intensity` prop — intensity is inherited via CSS.

### Cold-start rule (lines 15 + 41–52)

```ts
/** Minimum number of data points required to render the stepped bars. */
const COLD_START_THRESHOLD = 4;
```

```ts
const hasEnoughData = history.length >= COLD_START_THRESHOLD;

if (!hasEnoughData) {
  return (
    <div
      className="growth-motif growth-motif--cold-start"
      data-testid="growth-motif-cold-start"
    >
      <p className="growth-motif__cold-start-label">just getting started</p>
    </div>
  );
}
```

Cold-start fires when `history.length < 4`. Renders a plain div with a `<p>` saying "just getting started". No bars, no deltaLabel, no fabricated trend.

### EXACT inline style lines using var(--brand) / var(--brand-accent)

**var(--brand-accent) — non-current bars** (line 87):

```ts
backgroundColor: isLast ? 'var(--brand)' : 'var(--brand-accent)',
```

This single ternary expression appears in the `style` prop of each bar `<div>` (lines 84–91 block):

```tsx
<div
  key={i}
  role="presentation"
  className={`growth-motif__bar${isLast ? ' growth-motif__bar--current' : ''}`}
  style={{
    flex: 1,
    height: `${heightPct}%`,
    backgroundColor: isLast ? 'var(--brand)' : 'var(--brand-accent)',
    borderRadius: 'var(--radius)',
    minHeight: '2px',
  }}
/>
```

**var(--brand)** = current (last) bar.
**var(--brand-accent)** = all non-current bars.

The container `<div>` (lines 63–75) uses `var(--surface)` and `var(--radius)` but NOT `var(--brand)` or `var(--brand-accent)`.

The delta label `<p>` (lines 95–106) uses `var(--fg)` for color, not brand vars.

---

## 5. Signals Route — `src/app/api/teacher/student/[studentId]/signals/route.ts`

### EXACT returned JSON object (lines 243–263)

```ts
return NextResponse.json({
  student_id: studentId,
  current_band,
  per_skill_cl,
  recurring_misconceptions,
  // FIX 1 (a2): include divergence_flagged boolean (floor=20, SCOPE §6) for Plan 4 consumers
  divergence: {
    ...divergence,
    divergence_flagged: divergence.divergence_score >= 20,
  },
  effort: { dominant_effort_pattern },
  risk: {
    roster: roster_risk,
    session: session_risk,
  },
  reteach_outcomes,
  trajectory: {
    ...consistency,
    ...trajectoryResult,
  },
});
```

Top-level keys returned: `student_id`, `current_band`, `per_skill_cl`, `recurring_misconceptions`, `divergence` (object with spread + `divergence_flagged`), `effort` (object with `dominant_effort_pattern`), `risk` (object with `roster` and `session`), `reteach_outcomes`, `trajectory` (spread of consistency + trajectoryResult).

### snapshotScores — computed and then NOT returned (lines 228–235 + 238)

**Query (lines 227–231):**

```ts
const { data: snapshots } = await admin
  .from('student_model_snapshots')
  .select('snapshot_date, avg_score')
  .eq('student_id', studentId)
  .order('snapshot_date', { ascending: true })
  .limit(8);
```

**snapshotScores computed (lines 233–235):**

```ts
const snapshotScores = (snapshots ?? [])
  .map((s: { avg_score: number | null }) => s.avg_score)
  .filter((s): s is number => s != null);
```

**Used at line 238 to compute trajectoryResult — then dropped:**

```ts
const trajectoryResult = computeTrajectory(snapshotScores, false);
```

`snapshotScores` is passed into `computeTrajectory` and `trajectoryResult` is what gets spread into `trajectory: { ...consistency, ...trajectoryResult }`. The raw `snapshotScores` array is **never returned** in the JSON response. Only the derived `trajectoryResult` (the computed output of `computeTrajectory`) is returned under the `trajectory` key.

Line 233: `snapshotScores` defined.
Line 238: `snapshotScores` consumed by `computeTrajectory`.
Lines 258–261: `trajectory` key in return spreads `consistency` + `trajectoryResult` — NOT `snapshotScores`.
