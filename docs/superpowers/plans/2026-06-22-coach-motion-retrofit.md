# Coach-Motion Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the signature-moment four-beat motion (NOTICE → SPEAK → INVITE → DEFER) from the prototype to the four real coach surfaces — Teli, the "Worth a look?" coach card, the Alerts feed, and the High-Five note (teacher composer + student received note) — so the coach *moves like a person leaning in*, not a notification firing.

**Architecture:** One shared, token-sourced motion module (`src/lib/design/coachMotion.ts`) exposes the four-beat as reusable framer-motion variant builders + a reduced-motion helper. Each surface imports it; no surface hardcodes a duration/easing/spring. Server components that must animate get a *minimal* client island extracted (we do not client-ify whole server files). The shipped prototype is rewired to consume the same module (one source of motion truth).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, framer-motion ^12.40 (already a dependency from the prototype), Tailwind v4 token classes, Vitest 4 (+ jsdom for component tests).

## Global Constraints

*Every task's requirements implicitly include this section.*

- **Motion values come ONLY from `tokens.motion`** (via `src/lib/design/coachMotion.ts`). Never hardcode a duration, easing tuple, or spring in a surface component. Do not invent a new motion token without asking — this plan adds exactly two (`ease.exit`, `spring.spark`), which merely centralize values already shipped inline in the prototype.
- **`prefers-reduced-motion` is a first-class state (WCAG-AA):** every animated surface calls `useReducedMotion()` and, when true, snaps every beat to its end state (`duration: 0`, no stagger). This is non-negotiable and is the primary thing each component test asserts.
- **No user-facing copy changes** except ONE new line on the High-Five composer DEFER beat (`Sent to {name} — nice catch.`), which is a DRAFT → Barb (add to `STRINGS-FOR-BARB.md §High-Fives`). Every other surface animates **existing** strings only.
- **Leak discipline preserved:** animated components only render already-computed, leak-safe strings (coach_read is Option-D plain words; high-five text is guardrail-validated at send). No new data reaches any surface; four-audience rules are untouched.
- **Client/server boundary:** isolate the client boundary to the animated piece. Where a server component must animate (`WholeChildRail`), extract a small `'use client'` island rather than converting the whole file.
- **Token-only styling:** Tier-2 token classes only (no hex, no arbitrary `[var(--..)]`); content text is `text-fg`. Reuse existing tokens (`bg-brand`, `text-fg-on-brand`, `shadow-sticker`, `bg-sidebar-active`, `text-sidebar-active-fg`, `border-sidebar-edge`).
- **Component tests** start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`, and force reduced-motion via a `matchMedia` mock so framer-motion's `AnimatePresence` exits resolve instantly in jsdom (the established prototype pattern — see `src/app/(prototype)/signature-moment/__tests__/SignatureMoment.test.tsx`).
- **Coercion:** `useReducedMotion()` returns `boolean | null`; pass `!!reduce` to every builder.
- **Gates (final, before merge):** `npx tsc --noEmit` → 0 errors; `npm test` → all green; `npm run a11y` → 49/49; `npm run tokens:check` → clean; `npm run build` → 0. Per-task: run the named test file(s) + `npx tsc --noEmit`.

---

### Task 1: Motion foundation — `tokens.motion` extension + shared `coachMotion` module + prototype rewire

**Files:**
- Modify: `src/lib/design/tokens.ts` (add `ease.exit`, `spring.spark` to the `motion` export + its type)
- Create: `src/lib/design/coachMotion.ts`
- Test: `src/lib/design/__tests__/coachMotion.test.ts`
- Modify: `src/app/(prototype)/signature-moment/_registers.ts` (source motion from `COACH_MOTION`)
- Modify: `src/app/(prototype)/signature-moment/SignatureMoment.tsx` (consume shared builders; drop the two inline motion constants)

**Interfaces:**
- Consumes: `motion` (aliased `MT`) and `Cubic`/`Spring` types from `@/lib/design/tokens`.
- Produces (every later task relies on these exact names/signatures):
  - `type CoachRegisterKey = 'student' | 'teacher' | 'parent'`
  - `interface CoachMotionConfig { entrance: Transition; rise: { duration: number; ease: Cubic }; stagger: number; celebratory: boolean }`
  - `const COACH_MOTION: Record<CoachRegisterKey, CoachMotionConfig>`
  - `coachTransition(reduce: boolean, base: Transition): Transition`
  - `coachContainerVariants(reduce: boolean, cfg: CoachMotionConfig): Variants`
  - `coachMarkVariants(reduce: boolean, cfg: CoachMotionConfig): Variants`
  - `coachRiseVariants(reduce: boolean, cfg: CoachMotionConfig): Variants`
  - `coachSparkVariants(reduce: boolean): Variants`

- [ ] **Step 1: Write the failing test** — `src/lib/design/__tests__/coachMotion.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { motion as MT } from '@/lib/design/tokens';
import {
  COACH_MOTION,
  coachTransition,
  coachContainerVariants,
  coachMarkVariants,
  coachRiseVariants,
  coachSparkVariants,
} from '@/lib/design/coachMotion';

describe('coachMotion — token-sourced, reduced-motion-aware', () => {
  it('maps each register config to tokens.motion (no hardcoded values)', () => {
    expect(COACH_MOTION.teacher.rise.duration).toBe(MT.duration.fast);
    expect(COACH_MOTION.teacher.rise.ease).toBe(MT.ease.out);
    expect(COACH_MOTION.student.entrance).toMatchObject(MT.spring.playful);
    expect(COACH_MOTION.student.rise.duration).toBe(MT.duration.base);
    expect(COACH_MOTION.parent.rise.duration).toBe(MT.duration.slow);
    expect(COACH_MOTION.student.celebratory).toBe(true);
    expect(COACH_MOTION.teacher.celebratory).toBe(false);
  });

  it('coachTransition collapses to duration:0 under reduced motion', () => {
    expect(coachTransition(true, { duration: 0.45 })).toEqual({ duration: 0 });
    expect(coachTransition(false, { duration: 0.45 })).toEqual({ duration: 0.45 });
  });

  it('container drops the stagger under reduced motion', () => {
    const full = coachContainerVariants(false, COACH_MOTION.teacher);
    const reduced = coachContainerVariants(true, COACH_MOTION.teacher);
    expect((full.show as { transition: { staggerChildren: number } }).transition.staggerChildren)
      .toBe(COACH_MOTION.teacher.stagger);
    expect((reduced.show as { transition: object }).transition).toEqual({});
  });

  it('coach-mark hidden state is the lean-in (offset + tilt)', () => {
    const v = coachMarkVariants(false, COACH_MOTION.teacher);
    expect(v.hidden).toMatchObject({ opacity: 0, x: -18, rotate: -5, scale: 0.9 });
    expect(v.show).toMatchObject({ opacity: 1, x: 0, rotate: 0, scale: 1 });
  });

  it('rise hidden state is a y-offset fade', () => {
    const v = coachRiseVariants(false, COACH_MOTION.teacher);
    expect(v.hidden).toMatchObject({ opacity: 0, y: 14 });
    expect(v.show).toMatchObject({ opacity: 1, y: 0 });
  });

  it('spark snaps under reduced motion', () => {
    const v = coachSparkVariants(true);
    expect((v.show as { transition: { duration: number } }).transition.duration).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/design/__tests__/coachMotion.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/coachMotion'`.

- [ ] **Step 3: Extend `tokens.motion`** in `src/lib/design/tokens.ts` — add `exit` to `ease` and `spark` to `spring`, in BOTH the type annotation and the object literal:

```ts
export const motion: {
  duration: { instant: number; fast: number; base: number; slow: number; ambient: number };
  ease: { out: Cubic; inOut: Cubic; standard: Cubic; exit: Cubic };
  spring: { calm: Spring; playful: Spring; spark: Spring };
} = {
  duration: { instant: 0, fast: 0.18, base: 0.28, slow: 0.45, ambient: 0.9 },
  ease: {
    out: [0.16, 1, 0.3, 1],
    inOut: [0.65, 0, 0.35, 1],
    standard: [0.4, 0, 0.2, 1],
    exit: [0.4, 0, 1, 1],        // accelerate away — the DEFER ease
  },
  spring: {
    calm: { type: 'spring', stiffness: 200, damping: 30 },
    playful: { type: 'spring', stiffness: 380, damping: 22 },
    spark: { type: 'spring', stiffness: 500, damping: 16 },   // earned celebratory pop
  },
};
```

(`motion` is NOT part of the generated-CSS region — it's consumed only by framer-motion — so `tokens:check` is unaffected.)

- [ ] **Step 4: Create `src/lib/design/coachMotion.ts`**

```ts
// The signature four-beat (NOTICE → SPEAK → INVITE → DEFER) as reusable,
// token-sourced framer-motion variant builders. Every coach surface inherits
// its motion from here; nothing hardcodes a duration/easing/spring. See
// FEEL-DIRECTION.md (the motion SoT) and tokens.motion (the values).
import type { Transition, Variants } from 'framer-motion';
import { motion as MT, type Cubic } from '@/lib/design/tokens';

export type CoachRegisterKey = 'student' | 'teacher' | 'parent';

export interface CoachMotionConfig {
  /** coach-mark "lean-in" transition (NOTICE). */
  entrance: Transition;
  /** line/invite "rise" transition (SPEAK / INVITE). */
  rise: { duration: number; ease: Cubic };
  /** delay between staggered beats. */
  stagger: number;
  /** student-only celebratory spark on SPEAK. */
  celebratory: boolean;
}

/** Per-register motion — same four-beat, three feelings (see FEEL-DIRECTION.md). */
export const COACH_MOTION: Record<CoachRegisterKey, CoachMotionConfig> = {
  student: {
    entrance: { ...MT.spring.playful },                  // a touch of bounce
    rise: { duration: MT.duration.base, ease: MT.ease.out },
    stagger: 0.14,
    celebratory: true,
  },
  teacher: {
    entrance: { duration: MT.duration.fast, ease: MT.ease.standard },  // fast, minimal — restraint is the romance
    rise: { duration: MT.duration.fast, ease: MT.ease.out },
    stagger: 0.08,
    celebratory: false,
  },
  parent: {
    entrance: { duration: MT.duration.slow, ease: MT.ease.out },        // gentle, soft
    rise: { duration: MT.duration.slow, ease: MT.ease.out },
    stagger: 0.18,
    celebratory: false,
  },
};

/** Reduced-motion → instant (snap to end state). */
export const coachTransition = (reduce: boolean, base: Transition): Transition =>
  reduce ? { duration: 0 } : base;

/** Stagger orchestrator + the DEFER exit (card eases away). */
export function coachContainerVariants(reduce: boolean, cfg: CoachMotionConfig): Variants {
  return {
    hidden: {},
    show: { transition: reduce ? {} : { staggerChildren: cfg.stagger, delayChildren: 0.05 } },
    defer: {
      opacity: 0, y: 28, scale: 0.97,
      transition: coachTransition(reduce, { duration: cfg.rise.duration, ease: MT.ease.exit }),
    },
  };
}

/** NOTICE — the coach-mark leans in and squares up. */
export function coachMarkVariants(reduce: boolean, cfg: CoachMotionConfig): Variants {
  return {
    hidden: { opacity: 0, x: -18, y: 6, rotate: -5, scale: 0.9 },
    show: { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, transition: coachTransition(reduce, cfg.entrance) },
  };
}

/** SPEAK / INVITE — the line and the action rise in. */
export function coachRiseVariants(reduce: boolean, cfg: CoachMotionConfig): Variants {
  return {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: coachTransition(reduce, cfg.rise) },
  };
}

/** Student-only earned spark on SPEAK. */
export function coachSparkVariants(reduce: boolean): Variants {
  return {
    hidden: { opacity: 0, scale: 0, rotate: -30 },
    show: {
      opacity: 1, scale: 1, rotate: 0,
      transition: coachTransition(reduce, { ...MT.spring.spark, delay: 0.1 }),
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/design/__tests__/coachMotion.test.ts`
Expected: PASS (6/6).

- [ ] **Step 6: Rewire the prototype to the shared source (no behavior change).**

In `src/app/(prototype)/signature-moment/_registers.ts`, replace the per-register `entrance`/`rise`/`stagger`/`celebratory` literals by spreading from `COACH_MOTION`. Import it (`import { COACH_MOTION } from '@/lib/design/coachMotion';`) and, in each register object, replace those four fields with `...COACH_MOTION.student` / `...COACH_MOTION.teacher` / `...COACH_MOTION.parent` (keep all copy fields). The `Register` interface keeps its `entrance`/`rise`/`stagger`/`celebratory` shape (now satisfied by the spread).

In `src/app/(prototype)/signature-moment/SignatureMoment.tsx`, delete the local `EXIT_EASE` and `SPARK` constants and the inline `container`/`coachMark`/`riseV`/`sparkV` variant objects; import and use the shared builders instead:

```ts
import { COACH_MOTION, coachTransition, coachContainerVariants, coachMarkVariants, coachRiseVariants, coachSparkVariants } from '@/lib/design/coachMotion';
// ...
const cfg = COACH_MOTION[r.role];
const container = coachContainerVariants(!!reduce, cfg);
const coachMark = coachMarkVariants(!!reduce, cfg);
const riseV = coachRiseVariants(!!reduce, cfg);
const sparkV = coachSparkVariants(!!reduce);
```

Keep the existing `T()` helper usage for the one-off DEFER calm `<motion.p>` transition, or swap it to `coachTransition(!!reduce, …)` — either is fine; the local `T` may be removed if unused. Leave all JSX, the register toggle, replay, and copy unchanged.

- [ ] **Step 7: Verify the prototype still passes + types are clean**

Run: `npx vitest run src/app/(prototype)/signature-moment/__tests__/SignatureMoment.test.tsx && npx tsc --noEmit`
Expected: PASS (2/2) + 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/tokens.ts src/lib/design/coachMotion.ts src/lib/design/__tests__/coachMotion.test.ts "src/app/(prototype)/signature-moment/_registers.ts" "src/app/(prototype)/signature-moment/SignatureMoment.tsx"
git commit -m "feat(motion): shared coachMotion module + tokens.motion exit/spark; rewire prototype"
```

---

### Task 2: Teli — the coach's voice leans in and speaks (student register)

**Files:**
- Modify: `src/app/(student)/student/assignments/[id]/play/_components/TeliPanel.tsx`
- Test: `src/app/(student)/student/assignments/[id]/play/_components/__tests__/TeliPanel.test.tsx` (create if absent; extend if present)

**Interfaces:**
- Consumes: `COACH_MOTION`, `coachMarkVariants`, `coachRiseVariants` from `@/lib/design/coachMotion` (Task 1).

**Behavior:** each **Teli** turn's bubble *leans in* (NOTICE) on mount and its rung label + words *rise* staggered (SPEAK), in the student (delight) register. Student turns are unchanged. Already-mounted turns do not re-animate when a new one appends (framer runs `initial→animate` once, on mount). Reduced motion snaps to end state.

- [ ] **Step 1: Write the failing test** — mock `fetch`, force reduced motion, drive one hint, assert it renders.

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeliPanel } from '../TeliPanel';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ reply: 'What do you already know about the prompt?', hint_rung: 'nudge', hints_remaining: 3 }),
  } as Response);
});

describe('TeliPanel — coach voice', () => {
  it('renders an incoming Teli hint with its rung label after a help request', async () => {
    render(<TeliPanel attemptId="a1" step={0} taskDescription="desc" />);
    fireEvent.change(screen.getByLabelText('Ask Teli a question'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: /get a hint/i }));
    expect(await screen.findByText(/what do you already know/i)).toBeInTheDocument();
    expect(screen.getByText('A nudge')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/(student)/student/assignments/[id]/play/_components/__tests__/TeliPanel.test.tsx"`
Expected: it may PASS structurally today (hint already renders). To make this a true RED for the retrofit, FIRST add the new assertion that the Teli bubble is a `motion.li` carrying the rise structure — assert the rung label is present AND that the hint text node is rendered inside a list item (`screen.getByRole('listitem')` containing the text). If your initial run is green before any edit, that's acceptable for this retrofit (behavior is preserved); proceed — the edit's real guard is Step 4's reduced-motion render + tsc.

- [ ] **Step 3: Retrofit the thread.** Add imports at the top of `TeliPanel.tsx`:

```ts
import { motion, useReducedMotion } from 'framer-motion';
import { COACH_MOTION, coachMarkVariants, coachRiseVariants } from '@/lib/design/coachMotion';
```

Inside the component (after the state hooks): `const reduce = useReducedMotion();` and `const cfg = COACH_MOTION.student;`

Replace the `messages.map(...)` block (currently lines 151–167) with:

```tsx
{messages.map((msg, i) => {
  if (msg.role === 'student') {
    return (
      <li key={i} className="self-end bg-brand-surface rounded-xl px-3 py-2 text-fg text-sm max-w-[80%]">
        {msg.content}
      </li>
    );
  }
  // Teli turn — the coach SPEAKS: the bubble leans in, then rung + words rise.
  return (
    <motion.li
      key={i}
      initial="hidden"
      animate="show"
      variants={coachMarkVariants(!!reduce, cfg)}
      className="self-start bg-surface rounded-xl px-3 py-2 text-fg text-sm max-w-[80%]"
    >
      <motion.span
        className="block"
        variants={{ hidden: {}, show: { transition: reduce ? {} : { staggerChildren: cfg.stagger, delayChildren: 0.04 } } }}
      >
        {msg.rung && (
          <motion.span variants={coachRiseVariants(!!reduce, cfg)} className="block text-xs text-fg-muted mb-1">
            {RUNG_LABELS[msg.rung]}
          </motion.span>
        )}
        <motion.span variants={coachRiseVariants(!!reduce, cfg)} className="block">
          {msg.content}
        </motion.span>
      </motion.span>
    </motion.li>
  );
})}
```

(The `<ul>` wrapper stays a plain `<ul>` — only individual Teli `<li>`s animate, so appended turns don't restagger the whole thread.)

- [ ] **Step 4: Run the test + types**

Run: `npx vitest run "src/app/(student)/student/assignments/[id]/play/_components/__tests__/TeliPanel.test.tsx" && npx tsc --noEmit`
Expected: PASS + 0 type errors. Confirm the hint text and "A nudge" render under forced reduced motion (snap-to-end path).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(student)/student/assignments/[id]/play/_components/TeliPanel.tsx" "src/app/(student)/student/assignments/[id]/play/_components/__tests__/TeliPanel.test.tsx"
git commit -m "feat(motion): Teli hints lean in and rise (student register)"
```

---

### Task 3: "Worth a look?" coach card — extract a client island, NOTICE + SPEAK (teacher register)

**Files:**
- Create: `src/app/(teacher)/students/[studentId]/_components/CoachObservationCard.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx`
- Test: `src/app/(teacher)/students/[studentId]/_components/__tests__/CoachObservationCard.test.tsx`

**Interfaces:**
- Consumes: `COACH_MOTION`, `coachContainerVariants`, `coachMarkVariants`, `coachRiseVariants` (Task 1); `StudentSignals` from `@/lib/signals/loadStudentSignals`; `Card`, `SectionLabel`.

**Behavior:** the eyebrow chip leans in (NOTICE), the observation line + optional suggestion rise staggered (SPEAK), teacher register. `WholeChildRail` stays a **server** component; only this card is a client island. The `id="at-risk"` priority-CTA anchor moves onto the card's outer element (must be preserved).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoachObservationCard } from '../CoachObservationCard';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

describe('CoachObservationCard', () => {
  const coach = { eyebrow: 'Worth a look?', line: 'Leila has been quieter on the hard ones.', suggestion: 'A short check-in might help.', tone: 'warn' as const, state: 'watch' as const };

  it('renders the eyebrow, line, suggestion and keeps the #at-risk anchor', () => {
    const { container } = render(<CoachObservationCard coach={coach} />);
    expect(screen.getByText('Worth a look?')).toBeInTheDocument();
    expect(screen.getByText(/quieter on the hard ones/i)).toBeInTheDocument();
    expect(screen.getByText(/short check-in/i)).toBeInTheDocument();
    expect(container.querySelector('#at-risk')).not.toBeNull();
  });

  it('omits the suggestion paragraph when there is none', () => {
    render(<CoachObservationCard coach={{ ...coach, suggestion: null }} />);
    expect(screen.queryByText(/short check-in/i)).toBeNull();
  });
});
```

> The implementer must Read `src/lib/signals/loadStudentSignals.ts` to confirm the exact `coach_read` field types (`eyebrow`, `line`, `suggestion`, `tone`, `state`) and align the test's literal + the `CoachRead` type below. Adjust the test's `tone`/`state` literals to the real union if they differ.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/(teacher)/students/[studentId]/_components/__tests__/CoachObservationCard.test.tsx"`
Expected: FAIL — `Cannot find module '../CoachObservationCard'`.

- [ ] **Step 3: Create `CoachObservationCard.tsx`**

```tsx
'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../../_components/SectionLabel';
import { COACH_MOTION, coachContainerVariants, coachMarkVariants, coachRiseVariants } from '@/lib/design/coachMotion';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';

type CoachRead = StudentSignals['coach_read'];

export function CoachObservationCard({ coach }: { coach: CoachRead }): React.JSX.Element {
  const reduce = useReducedMotion();
  const cfg = COACH_MOTION.teacher;
  return (
    <motion.div id="at-risk" initial="hidden" animate="show" variants={coachContainerVariants(!!reduce, cfg)}>
      <Card tone={coach.tone}>
        <motion.div variants={coachMarkVariants(!!reduce, cfg)} className="mb-2">
          <SectionLabel tone={coach.tone}>{coach.eyebrow}</SectionLabel>
        </motion.div>
        <div className="flex flex-col gap-1.5">
          <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg text-[13px]">{coach.line}</motion.p>
          {coach.suggestion && (
            <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg text-[13px]">{coach.suggestion}</motion.p>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
export default CoachObservationCard;
```

- [ ] **Step 4: Wire it into `WholeChildRail.tsx`.** Add `import { CoachObservationCard } from './CoachObservationCard';` (with the other imports). Replace the "Worth a look?" block (currently lines 69–80, the `<div id="at-risk">…</div>`) with:

```tsx
{/* Worth a look? — EMA coach-read; #at-risk anchor lives on the animated card (priority CTA target) */}
<CoachObservationCard coach={signals.coach_read} />
```

Leave the rest of `WholeChildRail` (Mastery/Growing/Effort cards, the local `Eyebrow` helper still used by them, `storyLine`, `PriorityRecommendation`) untouched. The file stays a server component (no `'use client'`).

- [ ] **Step 5: Run the new test + the existing rail/leak tests + types**

Run: `npx vitest run "src/app/(teacher)/students/[studentId]/_components/__tests__/CoachObservationCard.test.tsx" "src/app/(teacher)/students/[studentId]/_components/__tests__/WholeChildRail.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx" && npx tsc --noEmit`
Expected: all PASS + 0 type errors. (If `WholeChildRail.test.tsx` asserted the old inline DOM shape of the at-risk block, update it to render through `CoachObservationCard` — the visible text and the `#at-risk` anchor are unchanged.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(teacher)/students/[studentId]/_components/CoachObservationCard.tsx" "src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx" "src/app/(teacher)/students/[studentId]/_components/__tests__/CoachObservationCard.test.tsx"
git commit -m "feat(motion): coach observation card leans in + speaks (teacher register)"
```

---

### Task 4: Alerts feed — rows arrive in a calm stagger (teacher register, least-motion)

**Files:**
- Modify: `src/app/(teacher)/alerts/_components/AlertsList.tsx`
- Test: `src/app/(teacher)/alerts/_components/__tests__/AlertsList.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `COACH_MOTION`, `coachRiseVariants` (Task 1).

**Behavior:** per FEEL-DIRECTION teacher restraint ("fastest, least motion"), rows do NOT do the full rotate lean-in; they **rise** in a soft stagger on mount — the arrival reads as a calm settling, not a tilting list. `AlertRow` is unchanged. Reduced motion → no stagger, instant.

- [ ] **Step 1: Write the failing test** — assert the stagger container wraps the rows (new structure) + rows still render.

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertsList } from '../AlertsList';
import type { AlertRowItem } from '../AlertRow';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

const rows: AlertRowItem[] = [
  { id: '1', student_id: 's1', student_name: 'Ada Lovelace', source_kind: 'low_quiz', severity: 'urgent', created_at: '2026-06-22T00:00:00Z' },
  { id: '2', student_id: 's2', student_name: 'Alan Turing', source_kind: 'reteach_flag', severity: 'watch', created_at: '2026-06-22T00:00:00Z' },
];

describe('AlertsList — calm staggered arrival', () => {
  it('renders each alert row under reduced motion (snap to end state)', () => {
    render(<AlertsList alerts={rows} classId="c1" />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** (or passes trivially today)

Run: `npx vitest run "src/app/(teacher)/alerts/_components/__tests__/AlertsList.test.tsx"`
Expected: FAIL if the test file is new and `next/navigation`'s `useRouter` is unmocked in jsdom — if so, the implementer adds `vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));` at the top. This is the real RED; resolve it in Step 3/4.

- [ ] **Step 3: Retrofit `AlertsList.tsx`** to the full file below:

```tsx
'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ALERT_BUCKETS } from '@/lib/copy/alertTriggerLabel';
import { SectionLabel } from '../../_components/SectionLabel';
import { AlertRow, type AlertRowItem } from './AlertRow';
import { COACH_MOTION, coachRiseVariants } from '@/lib/design/coachMotion';

export function AlertsList({ alerts, classId }: { alerts: AlertRowItem[]; classId: string }): React.JSX.Element {
  const router = useRouter();
  const reduce = useReducedMotion();
  const cfg = COACH_MOTION.teacher;
  const rise = coachRiseVariants(!!reduce, cfg);
  const stagger = { hidden: {}, show: { transition: reduce ? {} : { staggerChildren: cfg.stagger, delayChildren: 0.04 } } };
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {ALERT_BUCKETS.map((bucket) => {
        const rows = alerts.filter((a) => a.severity === bucket.severity);
        if (rows.length === 0) return null;
        return (
          <section key={bucket.severity} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <SectionLabel tone={bucket.severity === 'urgent' ? 'risk' : bucket.severity === 'watch' ? 'warn' : 'brand'}>{bucket.label}</SectionLabel>
              <span className="text-fg text-xs">{bucket.subline}</span>
            </div>
            <motion.div className="flex flex-col gap-3" variants={stagger} initial="hidden" animate="show">
              {rows.map((a) => (
                <motion.div key={a.id} variants={rise}>
                  <AlertRow alert={a} classId={classId} onResolved={() => router.refresh()} />
                </motion.div>
              ))}
            </motion.div>
          </section>
        );
      })}
    </div>
  );
}
export default AlertsList;
```

- [ ] **Step 4: Run the test + types**

Run: `npx vitest run "src/app/(teacher)/alerts/_components/__tests__/AlertsList.test.tsx" && npx tsc --noEmit`
Expected: PASS + 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/alerts/_components/AlertsList.tsx" "src/app/(teacher)/alerts/_components/__tests__/AlertsList.test.tsx"
git commit -m "feat(motion): alerts feed arrives in a calm stagger (teacher register)"
```

---

### Task 5: High-Five composer — the full four-beat with a small coach-mark (teacher register)

**Files:**
- Modify: `src/app/(teacher)/high-fives/_components/HighFiveComposer.tsx`
- Modify: `STRINGS-FOR-BARB.md` (add the DEFER calm line under §High-Fives)
- Test: `src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx` (create if absent; extend if present)

**Interfaces:**
- Consumes: `AnimatePresence`, `motion`, `useReducedMotion`; `COACH_MOTION`, `coachTransition`, `coachContainerVariants`, `coachMarkVariants`, `coachRiseVariants` (Task 1).

**Behavior:** when the composer opens (`active` set), a small coach-mark **leans in** (NOTICE), the "A note for {name}" + draft control + compose area + actions **rise** staggered (SPEAK/INVITE), all teacher register. On a successful send, the composer card **eases away** (DEFER) and a brief calm line — `Sent to {name} — nice catch.` — settles in its place, then clears after ~2.6s. All existing handlers (`draft`, `send`, `cancel`), the 422 violations block with its `role="alert"` / focus management, and `aria-invalid`/`aria-describedby` wiring are preserved exactly.

- [ ] **Step 1: Add the DEFER copy to `STRINGS-FOR-BARB.md`** under `§High-Fives` (DRAFT, Barb gates): `Sent to {name} — nice catch.` — note it's the post-send calm acknowledgment on the composer.

- [ ] **Step 2: Write the failing test** — open a composer, assert the coach-mark + name + actions render under reduced motion.

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HighFiveComposer } from '../HighFiveComposer';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

const suggestions = [{ student_id: 's1', full_name: 'Ada Lovelace', reason: 'persistence', context_hint: 'stuck with it on the hard set' }];

describe('HighFiveComposer — four-beat', () => {
  it('opens the composer with a name heading and Send/Cancel actions', () => {
    render(<HighFiveComposer classId="c1" suggestions={suggestions as never} roster={[] as never} recent={[] as never} />);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    expect(screen.getByText(/a note for ada lovelace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails / establishes the harness**

Run: `npx vitest run "src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx"`
Expected: PASS structurally if the composer already opens (it does today) — the meaningful guard is the reduced-motion render of the new `AnimatePresence`/coach-mark structure after Step 4. If new-file harness errors (unmocked router), the `vi.mock` above resolves them.

- [ ] **Step 4: Retrofit the composer.** Add to the imports:

```ts
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { COACH_MOTION, coachTransition, coachContainerVariants, coachMarkVariants, coachRiseVariants } from '@/lib/design/coachMotion';
```

Add state + the reduced-motion hook + the calm-clear effect (near the other hooks):

```ts
const reduce = useReducedMotion();
const cfg = COACH_MOTION.teacher;
const [sentName, setSentName] = useState<string | null>(null);

useEffect(() => {
  if (!sentName) return;
  const t = setTimeout(() => setSentName(null), 2600);
  return () => clearTimeout(t);
}, [sentName]);
```

In `send()`, on the success path, set the calm name before clearing — change:
`if (!res.ok) { … } setActive(null); setText(''); router.refresh();`
to:
```ts
if (!res.ok) { setErr('Could not send — try again.'); setBusy(false); return; }
setSentName(active.full_name);
setActive(null); setText(''); router.refresh();
```

Replace the entire `{active && ( <Card tone="brand"> … </Card> )}` block (currently lines 125–163) with the AnimatePresence + motion version below. Preserve every handler, the violations block verbatim, and the textarea attributes:

```tsx
<AnimatePresence mode="wait">
  {active ? (
    <motion.div key="composer" variants={coachContainerVariants(!!reduce, cfg)} initial="hidden" animate="show" exit="defer">
      <Card tone="brand">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <motion.div
              variants={coachMarkVariants(!!reduce, cfg)}
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-sidebar-edge bg-brand font-display font-extrabold text-fg-on-brand shadow-sticker"
            >
              C
            </motion.div>
            <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg font-display font-bold">A note for {active.full_name}</motion.p>
          </div>
          <motion.div variants={coachRiseVariants(!!reduce, cfg)} className="flex flex-wrap gap-2">
            <button type="button" onClick={draft} disabled={busy}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker transition-colors hover:bg-brand-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {busy ? 'Working…' : 'Draft with help'}
            </button>
          </motion.div>
          <motion.div variants={coachRiseVariants(!!reduce, cfg)} className="flex flex-col gap-3">
            <label className="sr-only" htmlFor="hf-text">Note text</label>
            <textarea id="hf-text" value={text} onChange={(e) => { setText(e.target.value); setAiDrafted(false); }}
              maxLength={600} rows={3}
              aria-invalid={violations.length > 0}
              aria-describedby={violations.length > 0 ? 'hf-violations' : undefined}
              className="w-full rounded-md border-2 border-sidebar-edge bg-surface p-2 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" />
            {violations.length > 0 && (
              <div ref={violationsRef} id="hf-violations" role="alert" aria-live="assertive" tabIndex={-1}
                className="rounded border-2 border-sidebar-edge bg-risk-surface p-2 text-fg">
                <p className="text-sm font-bold">⚠ Let&apos;s reword this</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {violations.map((v, i) => <li key={i} className="text-fg text-sm">Avoid &quot;{v.phrase}&quot; — {v.suggestion}</li>)}
                </ul>
              </div>
            )}
            {err && <p className="text-fg text-sm">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={send} disabled={busy || text.trim().length === 0}
                className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-1 text-sm font-bold text-fg-on-brand shadow-sticker transition-transform hover:-translate-y-0.5 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Send
              </button>
              <button type="button" onClick={() => setActive(null)}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker transition-colors hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      </Card>
    </motion.div>
  ) : sentName ? (
    <motion.p key="calm" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={coachTransition(!!reduce, { duration: cfg.rise.duration, ease: cfg.rise.ease })}
      className="text-fg-muted text-sm">
      Sent to {sentName} — nice catch.
    </motion.p>
  ) : null}
</AnimatePresence>
```

- [ ] **Step 5: Run the test + types**

Run: `npx vitest run "src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx" && npx tsc --noEmit`
Expected: PASS + 0 type errors. The composer opens with the coach-mark + "A note for Ada Lovelace" + Send/Cancel under forced reduced motion.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(teacher)/high-fives/_components/HighFiveComposer.tsx" "src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx" STRINGS-FOR-BARB.md
git commit -m "feat(motion): high-five composer four-beat + coach-mark + DEFER calm (teacher register)"
```

---

### Task 6: Student received high-five — the delight reveal (student register + spark)

**Files:**
- Create: `src/app/(student)/student/dashboard/_components/HighFiveNote.tsx`
- Modify: `src/app/(student)/student/dashboard/page.tsx`
- Test: `src/app/(student)/student/dashboard/_components/__tests__/HighFiveNote.test.tsx`

**Interfaces:**
- Consumes: `COACH_MOTION`, `coachContainerVariants`, `coachMarkVariants`, `coachRiseVariants`, `coachSparkVariants` (Task 1).

**Behavior:** the kid seeing recognition is the highest-warmth coach moment — student (delight) register: a small star coach-mark leans in with an earned spark, the note text rises. The dashboard page stays a **server** component; `HighFiveNote` is the client island. Reduced motion → instant. The text is guardrail-validated at send; render is leak-safe.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighFiveNote } from '../HighFiveNote';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

describe('HighFiveNote', () => {
  it('renders the note text', () => {
    render(<HighFiveNote text="You kept going when it was hard — that's real grit." />);
    expect(screen.getByText(/kept going when it was hard/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/(student)/student/dashboard/_components/__tests__/HighFiveNote.test.tsx"`
Expected: FAIL — `Cannot find module '../HighFiveNote'`.

- [ ] **Step 3: Create `HighFiveNote.tsx`**

```tsx
'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { COACH_MOTION, coachContainerVariants, coachMarkVariants, coachRiseVariants, coachSparkVariants } from '@/lib/design/coachMotion';

export function HighFiveNote({ text }: { text: string }): React.JSX.Element {
  const reduce = useReducedMotion();
  const cfg = COACH_MOTION.student;
  return (
    <motion.div variants={coachContainerVariants(!!reduce, cfg)} initial="hidden" animate="show" className="flex items-start gap-2">
      <motion.div
        variants={coachMarkVariants(!!reduce, cfg)}
        aria-hidden="true"
        className="relative grid size-8 shrink-0 place-items-center rounded-full border-2 border-sidebar-edge bg-brand font-display font-extrabold text-fg-on-brand shadow-sticker"
      >
        ★
        {cfg.celebratory && (
          <motion.span
            variants={coachSparkVariants(!!reduce)}
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border-2 border-sidebar-edge bg-sidebar-active text-[9px] text-sidebar-active-fg shadow-sticker"
          >
            ✦
          </motion.span>
        )}
      </motion.div>
      <motion.p variants={coachRiseVariants(!!reduce, cfg)} className="text-fg text-base leading-relaxed">{text}</motion.p>
    </motion.div>
  );
}
export default HighFiveNote;
```

- [ ] **Step 4: Wire it into `page.tsx`.** Add `import { HighFiveNote } from './_components/HighFiveNote';`. Replace the notes map (currently lines 19–21) with:

```tsx
{notes.map((n) => (
  <HighFiveNote key={n.id} text={n.note_text} />
))}
```

Leave the server page otherwise unchanged (still `async`, still `requireRole(['student'])`, still the "A note from your teacher" header).

- [ ] **Step 5: Run the new test + types**

Run: `npx vitest run "src/app/(student)/student/dashboard/_components/__tests__/HighFiveNote.test.tsx" && npx tsc --noEmit`
Expected: PASS + 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(student)/student/dashboard/_components/HighFiveNote.tsx" "src/app/(student)/student/dashboard/page.tsx" "src/app/(student)/student/dashboard/_components/__tests__/HighFiveNote.test.tsx"
git commit -m "feat(motion): student high-five reveal — delight register + spark"
```

---

## Post-build (controller, before merge)

1. **Full gates:** `npx tsc --noEmit` · `npm test` · `npm run a11y` · `npm run tokens:check` · `npm run build` — all green.
2. **Playwright preview per surface** (binding review rule [[v2-frontend-review-workflow]]): run the dev server, capture each surface live (Teli mid-hint, the coach card, the alerts feed, the composer open + post-send calm, the student note), and bring screenshots + any proposed visual tweak to Marvin. **Mods are propose-only — Marvin approves before applying.** Toggle OS reduced-motion to confirm the snap path on at least one surface.
3. **Final whole-branch adversarial review** (the in-house Workflow review) before merge.

## Self-Review (controller, completed at plan-write time)

- **Spec coverage:** all four FEEL-DIRECTION retrofit targets covered — Teli (Task 2), coach card (Task 3), Alerts (Task 4), High-Five note both sides (Tasks 5–6). Shared foundation (Task 1) realizes "pull motion from `tokens.motion`". Both Marvin decisions honored: all four surfaces; coach-mark added to the composer.
- **Placeholder scan:** none — every code step carries full code.
- **Type consistency:** the six exports in Task 1's Produces block are consumed by Tasks 2–6 with matching signatures; `CoachRead = StudentSignals['coach_read']` (Task 3) is verified against the real loader at implement time (flagged in Task 3 Step 1).
- **Known risk:** component tests for motion rely on the matchMedia reduced-motion mock (the established prototype pattern) so `AnimatePresence` resolves in jsdom; real motion is verified live via Playwright (post-build step 2).
