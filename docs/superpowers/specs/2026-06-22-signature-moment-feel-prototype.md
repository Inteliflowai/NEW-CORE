# Signature Moment — Feel Prototype (V2-adapted)

**Status:** READY TO RUN — queued right after Epic 3b merges (before Epic 4). Decision: [[v2-signature-moment-feel-prototype]] memory.
**What this is:** a FEEL prototype of CORE's signature interaction — the coach NOTICES and SPEAKS — choreographed to feel alive, in three registers. Mock data, exploration, does NOT touch the shell or production screens.

---

## V2 adaptations vs the source prompt (which was written for V1)

| Source (V1) | V2 (`new-core`) |
|---|---|
| repo `core-platform` | repo `new-core` (this repo) |
| `lib/design/tokens.ts` | **No such file.** Tokens live in `src/app/globals.css` (3-tier). Register theming = `data-role` / `data-intensity` attributes that rebind tokens (e.g. teacher shell uses `data-role="teacher"` `data-intensity="calm"`; student = pop-art / loud). |
| `app/(dashboard)/` route | route groups under `src/app/`: `(teacher)`, `(student)`, `(parent)`. |
| motion: unspecified | **framer-motion** (add the dependency — V2 has ZERO motion today). |
| prototype placement | isolated throwaway route, e.g. `src/app/(prototype)/signature-moment/page.tsx` — NOT inside an auth-gated production group; never shipped. Build step (c) resolves the exact path. |

V2-specific guardrails (in addition to the source constraints):
- **`prefers-reduced-motion` is MANDATORY** (WCAG-AA): every beat degrades to an instant, motion-free state.
- **Token-only even in the prototype** — no hardcoded hex, no arbitrary `[var(--..)]`; use the 3-tier token classes.
- **Student "celebratory beat" stays frictionless-not-addictive** ([[student-surface-design-principles]]): a small, earned beat — never slot-machine dopamine (over-gamified UX pollutes the behavioral-signal data).
- **FEEL-DIRECTION.md** is a NEW artifact at repo root, sibling to `COACH-POSTURE.md`.

---

## The prompt (run this in Claude Code, V2 repo)

```
GOAL
Prototype CORE 2.0's signature interaction: the single moment where the coach
NOTICES something and SPEAKS to the user. This one moment is the soul of the
product — an interface that notices and talks to you like a perceptive person is
a feeling no competitor has, and it is what will make teachers, students, and
parents fall in love with CORE. Build this ONE interaction, made to feel ALIVE,
in three emotional registers. This is a feel PROTOTYPE — mock data, exploration,
not wired to production signals. Repo is V2 (new-core).

WHY THIS FIRST
People don't fall in love with polished screens; they fall in love with a
signature feeling. CORE's signature is "the coach over your shoulder." Nail the
moment it notices and speaks — entrance, motion, phrasing, the invitation to act
— and that becomes the soul every other screen is built around.

FEEL DIRECTION (the soul — capture this as FEEL-DIRECTION.md at repo root)
- PERSONALITY: a perceptive, experienced master teacher watching over your
  shoulder. Warm, economical, never showy. Notices the one thing, says it
  plainly, offers a hand, then steps back. Confident enough to be brief.
- MOTION LANGUAGE: calm and purposeful, never frantic or attention-grabbing. The
  coach ARRIVES (leans in) rather than pops or alerts. Movement settles softly,
  invites rather than demands, and exits quietly. Easing is gentle (ease-out, no
  harsh bounces — except a touch of playful spring in the student register).
  Nothing flashes or nags.
- THE ONE SIGNATURE MOVE: a choreographed four-beat — NOTICE -> SPEAK -> INVITE
  -> DEFER. This beat is the heartbeat of the whole app; every register plays the
  same beat in a different emotional color.

THE SIGNATURE MOMENT — anatomy (build each beat to be FELT)
1. NOTICE (entrance): the coaching note arrives like a person leaning in — a
   soft, intentional entrance, NOT a toast/banner/alert firing.
2. SPEAK (the observation): ONE thing, in plain human language — what a great
   teacher would say out loud. Never a metric, score, percentile, or jargon.
3. INVITE (the action): a suggested next step the user can accept or dismiss. The
   coach offers; the human decides. Never auto-acts, never delivers a verdict.
4. DEFER (exit): once acted on or dismissed, it gets out of the way and goes
   quiet. The calm afterward is part of the feeling.

THREE EMOTIONAL REGISTERS — same beat, three feelings
- STUDENT (pop-art) -> DELIGHT + MOMENTUM. Playful, energetic, a touch of spring,
  a small celebratory beat when they've done well — an excited guide. Bright and
  kinetic, but still ONE thing, still defers. Keep it earned, never addictive.
  Draft line: "Nice — your writing's getting sharper. Want to level up your
  endings next?"
- TEACHER (credible / cobalt) -> RELIEF + COMPETENCE. Calm, fast, respectful of
  time. RESTRAINT IS THE ROMANCE — hand the teacher exactly the one thing that
  matters and step back. Minimal motion, instant response. A busy animated
  dashboard is the OPPOSITE of lovable here — say less.
  Draft line: "Leila's cohesion dipped this week. Want a 5-minute reteach you can
  run tomorrow?"
- PARENT (warm) -> REASSURANCE + PRIDE. Plain, warm, human, no jargon — a kind
  teacher telling you how your child is really doing and how to cheer them on.
  Gentle, soft, proud.
  Draft line: "Maya's reading is really coming along this month. Here's one small
  way to cheer her on at home."

WHAT TO BUILD (prototype scope, V2)
- A self-contained interactive prototype at an ISOLATED route (e.g.
  src/app/(prototype)/signature-moment/page.tsx) that plays the "coach notices and
  speaks" moment, with a TOGGLE to switch the three registers (student / teacher /
  parent) so we can feel all three side by side. It must NOT touch the shell or any
  production screen.
- REAL motion via framer-motion: build the four-beat choreography (notice -> speak
  -> invite -> defer) with actual entrance / settle / exit timing and easing per
  register. The whole point is the FEELING — timing, easing, micro-feedback.
- MOCK data only: hardcode one believable coaching moment per register (the draft
  lines above). Do NOT wire to real signals or the engine.
- Use the V2 token system in src/app/globals.css (3-tier) + register theming via
  data-role / data-intensity (student = pop-art/loud; teacher = cobalt/calm;
  parent = warm). Do NOT invent a new visual language and do NOT add hardcoded hex.
- Include a control to REPLAY the moment.

CONSTRAINTS
- Obey COACH-POSTURE.md: speaks first, ONE thing, plain language, suggests-not-
  decides, quiet when done, NOT a chatbot.
- Plain human language, never geek (no scores / percentiles / indexes / jargon in
  any visible copy). Enforce via the src/lib/copy leak guards if you surface text.
- DIAGNOSTIC WALLS: each register shows only what that audience should see;
  students and parents get growth-framed language, never risk-layer detail.
- prefers-reduced-motion: every beat MUST degrade to an instant, motion-free state.
- PROTOTYPE only: mock data, exploration. Do NOT refactor the shell or existing
  screens, do NOT wire production signals.
- DRAFT phrasing -> write each line into STRINGS-FOR-BARB.md as a proposal. Barb
  gates all user-facing copy.

THE TEST (what "alive" means — judge against this)
- Does the note feel like a person leaning in, or a notification firing? Person =
  pass.
- Does each register evoke its target feeling — student delight, teacher relief,
  parent reassurance — within the first second?
- Is it ONE thing, plainly said, with an invitation, then quiet?
- Restraint check (teacher): does it respect a busy teacher's time, or is it doing
  too much? Too much = fail.

DELIVERABLES
- The interactive prototype (isolated route) with the three-register toggle + a
  replay control.
- FEEL-DIRECTION.md (repo root) capturing personality + motion language + the
  four-beat signature move, so future screens inherit the soul.
- STRINGS-FOR-BARB.md proposals for the three draft lines.
- A short note on the motion choices per register (timing / easing and why).
- Run a full build; report status. Do not start a dev server.

BEFORE CODING — show me:
  (a) the V2 token system (src/app/globals.css 3-tier) and how registers are
      themed via data-role / data-intensity,
  (b) confirm COACH-POSTURE.md exists,
  (c) the exact isolated route path you'll use so it does not touch production.
Then build.
```

---

## After the prototype (the payoff)
Lock `FEEL-DIRECTION.md`, then **retrofit** the motion vocabulary onto the real surfaces that already do beats 1-3 statically: Today's `coachObservation`, the alerts feed, the high-fives "worth recognizing" → note → student view (3b), and Teli. That retrofit is the follow-on, scoped per surface, Barb gating any new copy.
