# CORE v2 — Plan 4a: Design-System Foundation — Design Spec

_Brainstormed 2026-06-18 (visual decisions made interactively). The shared UI foundation every role screen (4b–4e) imports. No role screens are built here — this is the system they stand on._

## Goal

Build the **fresh design-system foundation**: the locked visual direction (palette, role-accent system, typography, signature element), the swappable token architecture, the loud/credible intensity mechanism, the shared component kit (layout shells, CLBadge, the Growth-motif signature, the KaTeX math renderer, banded risk/mastery display, cold-start states), the copy registers, and the **WCAG-AA contrast gate in CI**. Everything in 4b–4e imports this; nothing renders a screen until it exists. (Spec §9 specified the *bones*; this plan fills in the now-locked specifics and builds the kit.)

## Locked visual direction (decided in brainstorming)

- **One CORE brand, per-role accent + intensity.** A single brand (one logo, one type, one shape language, one neutral system); color is an **accent**, never a per-role reskin. Each role gets a signature hue; the loud/credible split is an intensity of the *same* DNA.
- **Role → signature color:**
  - **Student** → emerald + lime green, **loud** (vivid, playful — "growth/go")
  - **Teacher** → cobalt blue, **credible** (the daily pro tool)
  - **Parent** → warm coral, **credible** (warm, human — "is my kid okay")
  - **School Admin** → indigo-black, **dark command center** (sober oversight)
  - **Super-admin** → charcoal + amber signal, **dark** (utilitarian platform/ops; distinct from Admin)
  - Structure: **light = people-facing** (Student loud, Teacher/Parent calm); **dark = command centers** (Admin, Super-admin — two distinct darks).
- **Typography:** **Bricolage Grotesque** (display/headlines — personality) + **Inter** (body/UI — maximal legibility). Display carries the boldness; body stays effortless to read.
- **Signature element: the Growth motif.** CORE's recognizable device is *how it shows growth vs the student's own past* — a bold stepped "you vs 4 weeks ago" visual. Loud/celebratory on Student, calm/dignified on adult surfaces. The product's soul made into the brand element; never peer-relative (SCOPE §16).
- **Readability is non-negotiable (fixes the V1 complaint):** body text = deep ink; secondary text only to a mid-ink that still clears AA; **no dim gray-on-white, ever.** Enforced by a CI contrast gate (below).

## Token architecture (spec §9.2 — three layers, palette swappable)

- **Tier 1 — Primitives** (`:root` in `globals.css`, the ONLY place hex literals live). Ramps, not single colors: `--emerald-50…950`, `--lime-50…950`, `--cobalt-50…950`, `--coral-50…950`, `--amber-50…950`, plus a neutral `--ink-50…950` ramp (the deep-ink readability anchor) and `--canvas` (near-white) / dark canvases (`--canvas-admin` indigo-black, `--canvas-platform` charcoal).
- **Tier 2 — Semantic slots** (abstract, role-agnostic): `--brand`, `--brand-accent`, `--bg`, `--surface`, `--fg` (body ink), `--fg-muted` (AA-clearing secondary), `--fg-on-brand`, `--ok`/`--warn`/`--risk` signal slots, `--radius`, `--shadow`. Components reference ONLY Tier-2 — so hues swap without renaming.
- **Tier 3 — Role/intensity binding:** the role layout boundary sets the Tier-2 slots from the role's primitive ramp via two attributes (below). Components never hardcode emerald/cobalt/etc.
- **Tailwind v4:** tokens exposed via `@theme` in `globals.css` (NO `tailwind.config.js`, per the stack). Replace the CRA-boilerplate `globals.css` (Geist + the unused dark-mode block).

## Intensity + role mechanism (spec §9.3 — one DNA, two tiers)

One token set, switched at a layout boundary by two `data-*` attributes — NOT two design systems and NOT prop-drilling:
- `data-role="student|teacher|parent|admin|super-admin"` — binds the Tier-2 `--brand`/`--brand-accent`/canvas slots to that role's ramp.
- `data-intensity="loud|calm"` — student=`loud` (saturated blocks, chunky radii, the loud Growth motif, bigger display type); adults=`calm` (near-white or dark canvas, restrained accents, subtle elevation). CSS overrides keyed on these attributes; components stay identical.
The 5 role route-group layouts (`(student)`, `(teacher)`, `(parent)`, `(school-admin)`, `(super-admin)`) each set these on their layout shell.

## Fonts (next/font)

`next/font/google` for **Bricolage Grotesque** (`--font-display`, variable/optical-size) + **Inter** (`--font-sans`) in `layout.tsx`; expose as CSS vars; map in `@theme`. No external `<link>`/`@import` (self-hosted via next/font for perf + privacy).

## shadcn/ui (spec §9.4)

Initialize shadcn/ui (the locked component lib) against the token layer (its CSS-var theme points at the Tier-2 slots, so shadcn primitives inherit role/intensity automatically). Pull only the primitives the kit needs (button, card, badge, dialog, tabs, table, skeleton) — not the whole library.

## Shared component kit (built in this plan)

Each is import-safe, themed via tokens (no hardcoded hex), tested. Consumes the Plan-1–3 data shapes / read-API responses; renders nothing diagnostic on student/parent surfaces.

- **`RoleLayout` shells (×5)** — the route-group layouts that set `data-role` + `data-intensity`, the role nav, the ◆ CORE mark, and the shared frame. The 4b–4e screens mount inside these.
- **`GrowthMotif`** (the signature) — props `{ history: number[]; deltaLabel?: string; intensity }`. Renders the stepped "you vs 4 weeks ago" growth visual; loud (emerald/lime, celebratory) vs calm (role-accent, restrained). Cold-start (<4 points) → a dignified "just getting started" state, never a fabricated trend.
- **`CLBadge`** — the comprehension-level verb display. Consumes `skill_learning_state.state` → `CL_VERB_BY_STATE` (Reinforce / On Track / Enrich); `insufficient_data`/`not_attempted` → **"Not yet assessed"**. Confidence shown as **soft words** (emerging/tentative/consistent), never the 0–100 number. **Teacher-surface only** (students/parents never see CL).
- **`MasteryLabel`** — reuses the existing `src/lib/utils/masteryLabel.ts` (`reteach→Building / grade_level→On Track / advanced→Strong / null→"Not yet assessed"`). The "never Band" rule rendered. Soft words on every surface.
- **`RiskBadge`** — renders risk as a **banded label** (low/medium/high/critical) with role-appropriate color, **never the raw 0–100 or 0–1 number** (carry-forward fix). Teacher/admin only.
- **`MathText`** (KaTeX) — renders inline/block math from the engine's `$…$`/`$$…$$` content. Wraps KaTeX; safe fallback to raw text on parse error (never crashes a quiz). **Adds the `katex` dependency** (V2 doesn't have it yet; V1 used `katex ^0.16.45`) + a small React render wrapper. Required because the engine already generates math (`is_math`, `numeric_spec`, the math-format prompt directive) but nothing renders it.
- **`StatCard` / `Card`** — the shared card surface; loud = chunky radius + pop shadow, calm = subtle elevation (intensity-driven). The signature lives in `GrowthMotif`, so cards stay calm-by-default.
- **Cold-start / empty states** — first-class shared components ("Not yet assessed," "just getting started," "you're on track — keep going"); never fabricate.

## Copy registers (language rules baked into the kit)

Centralized helpers so screens can't drift (ties to SCOPE §15 + the four-audience discipline):
- **Never "Band"** — `MasteryLabel` soft words only.
- **"Still building," not "struggle"** — a `topicFrame()` helper renders `struggle_topics` as "still building" on student/parent surfaces (carry-forward B4).
- **Banded risk, not numbers** — `RiskBadge` (carry-forward F1/PIPELINE).
- **Observational, never diagnostic, never peer-relative** — copy constants for growth ("you vs 4 weeks ago"), suppression-when-fine, "Not yet assessed."

## WCAG AA contrast gate (spec §9.5 — a build gate)

A CI script (`scripts/a11y/contrast-check.ts`) iterates every Tier-2 fg/bg token pairing for both intensities + all 5 roles and asserts WCAG AA (≥4.5:1 body, ≥3:1 large/UI). Wired into `npm run` + the build. This is the structural guarantee that "no dim text" can't regress — the user's explicit V1 pain, made un-shippable.

## Data flow

Tokens (`globals.css` `:root` + `@theme`) → role layout sets `data-role`/`data-intensity` → shadcn + kit components read Tier-2 slots → screens (4b–4e) compose the kit. The kit components consume the existing read-API shapes (teacher one-student/roster, student growth) — they do not fetch; screens pass data in.

## Error handling

- `MathText` degrades to raw text on a KaTeX parse error (a malformed `$…$` never blanks a quiz).
- Cold-start everywhere → the dignified empty states, never a fabricated value.
- Missing/null signal fields → the kit renders the "Not yet assessed"/"just getting started" state.

## Testing

- Component tests (Vitest + React Testing Library — add `@testing-library/react` + jsdom env): `CLBadge` (each state→verb, null→"Not yet assessed", confidence-as-words), `MasteryLabel` (each band→soft word, the existing util test extended), `RiskBadge` (banded never raw number), `GrowthMotif` (cold-start vs trend, loud vs calm), `MathText` (renders `$x^2$`, degrades on bad input).
- The **contrast gate** runs in CI (a failing pair fails the build).
- `npm run build` green; `npx tsc --noEmit` clean.

## Out of scope (the per-role plans)

- All actual **screens** (Teacher Today/One Student/Create/Classes; Student Home/Do-the-Work/Spark; Parent narrative; Admin/Super-admin) → 4b–4e.
- **Super TELI** (the AI tutor) + **first-run onboarding** → later sub-plans.
- The **in-quiz telemetry capture** (feeds session risk) → 4c (Student "Do the Work").
- **Parent narrative generation** + `parent_narrative_cache` + Resend → 4d.
- Final exact hex ramps may be tuned during the build, but the *direction* and the token *architecture* are locked here.

## Open items flagged for review

- Dark-mode (system pref) is NOT in scope — the role canvases (light people-facing / dark command-centers) are deliberate, not a user toggle; a separate dark mode is deferred.
- The exact lime/emerald balance on the loud Student tier and the cobalt depth may be tuned against the real KaTeX/number-heavy screens in 4b/4c — the token layer makes that a values-only change.
- The mastery soft-word labels (Building/On Track/Strong) are working labels; if Barb refines the exact mastery wording, it's a one-line change in `masteryLabel.ts` (single-sourced).
