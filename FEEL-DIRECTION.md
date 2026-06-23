# FEEL-DIRECTION.md — the soul of CORE V2

> Sibling to [`COACH-POSTURE.md`](COACH-POSTURE.md). COACH-POSTURE governs what the
> coach *says* and *when*; FEEL-DIRECTION governs how it *moves and feels*. Locked
> from the signature-moment prototype (`src/app/(prototype)/signature-moment/`,
> Marvin sign-off 2026-06-22). Every animated surface inherits this.

## Personality
A perceptive, experienced **master teacher watching over your shoulder.** Warm,
economical, never showy. Notices the **one** thing, says it plainly, offers a hand,
then **steps back.** Confident enough to be brief. It is a presence, **not a chatbot.**

## Motion language
- **The coach ARRIVES — it does not fire.** Movement reads like a person *leaning
  into frame*, never a toast/banner/alert popping. It draws a glance without
  startling.
- **Calm and purposeful.** Settles softly, invites rather than demands, and **exits
  quietly.** Nothing flashes, nags, pulses, or competes for attention.
- **Gentle easing.** Default is ease-out (a soft "settle"): `tokens.motion.ease.out`
  `[0.16, 1, 0.3, 1]`. A *touch* of playful spring in the **student** register only.
- **Restraint is the romance.** For a busy teacher, lovable = the app says less and
  respects their time. When in doubt, **less motion.**
- **Reduced motion is a first-class state**, not an afterthought: `useReducedMotion()`
  → every beat snaps to its end state instantly (WCAG-AA).

## The signature move — one four-beat heartbeat
`NOTICE → SPEAK → INVITE → DEFER`. The heartbeat of the whole app; every register
plays the same beat in a different emotional colour. The two **memorable** elements:
the **lean-in** entrance, and the **designed DEFER calm** (most apps never choreograph
the exit).

1. **NOTICE (entrance).** The coach-mark *leans in* — arrives with a slight offset +
   tilt (`x:-18, rotate:-5, scale:0.9`) and squares up to rest. A person leaning in,
   not an icon appearing.
2. **SPEAK (the observation).** The **one** line rises in (`y:14 → 0`, fade), staggered
   after the coach settles. Plain human words — never a metric/score/percentile/jargon.
3. **INVITE (the action).** A primary "yes" + a quiet decline rise in last. The coach
   **offers; the human decides.** Never auto-acts, never delivers a verdict.
4. **DEFER (exit).** On accept or dismiss the card **eases away** (`y:+28, scale:0.97`,
   fade out) and a brief, quiet acknowledgment settles in its place, then stillness.
   **The calm afterward is part of the feeling.**

Staggered reveal via framer-motion `staggerChildren` + `delayChildren`; exit via
`AnimatePresence`. Replaying = remount.

## The three registers — same beat, three feelings
Switched by `data-role` / `data-intensity` (colour) + the per-register motion config.
All values come from `src/lib/design/tokens.ts` (`motion`).

| Register | Feeling | Colour (role) | Entrance | Rhythm | Signature touch |
|---|---|---|---|---|---|
| **Student** (loud) | Delight + momentum | emerald + lime | `spring.playful` (stiffness 380 / damping 22) | `duration.base` 0.28s, stagger 0.14 | a small **celebratory spark** (lime ✦) on SPEAK — earned, never slot-machine |
| **Teacher** (calm) | Relief + competence | cobalt | `ease.standard`, `duration.fast` 0.18s | fast, stagger 0.08 | **minimal** — fastest, least motion; restraint is the romance |
| **Parent** (calm) | Reassurance + pride | coral (warm) | `ease.out`, `duration.slow` 0.45s | gentle, stagger 0.18 | **soft + slow** — the most relaxed arrival |

## How future screens inherit the soul
- **Pull motion from `tokens.motion`** — never hardcode durations/easings/springs
  (ask before inventing a motion token; see [`v2-design-token-discipline`]).
- **Animate the coach beats, not the chrome.** Use the NOTICE/SPEAK/INVITE/DEFER
  pattern wherever the coach surfaces; don't animate dashboards or decorations.
- **Always honor `prefers-reduced-motion`** (snap to end state).
- **Retrofit targets** (the static versions of this beat, to bring alive next): Today's
  `coachObservation` (NOTICE+SPEAK), the Alerts feed (NOTICE), the High-Fives note
  (NOTICE→SPEAK→INVITE, Epic 3b), and Teli (the coach's voice).

## The test (judge "alive" against this)
- Person leaning in, or a notification firing? **Person = pass.**
- Does each register evoke its feeling within the first second?
- One thing, plainly said, with an invitation, then **quiet**?
- Teacher restraint check: respects a busy teacher's time, or doing too much?
  **Too much = fail.**

*All prototype copy is DRAFT → Barb (`STRINGS-FOR-BARB.md` §Signature-Moment).*
