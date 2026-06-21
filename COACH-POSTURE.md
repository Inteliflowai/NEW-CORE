# COACH-POSTURE.md — CORE's governing product posture

> **Status:** governing standard. **All** CORE surface work (student, teacher,
> parent, admin — V2 and Eduflux) must obey this. Referenced from `CLAUDE.md`.
> Authored from Barb's product-posture brief (2026-06-20).

## The moat, in one line

CORE behaves like an **experienced human coach watching over the teacher's
shoulder** — it notices the one thing worth saying, says it in plain human
language, suggests an action, and defers to the human.

This is our moat (Barb's words): **no EdTech software behaves like this.** Most
EdTech is a **dashboard that WAITS** — it shows data when you go look. CORE is a
**coach that NOTICES and speaks up at the right moment.** Differentiated learning
is not new; a system that behaves like a coach is. Every design decision is
measured against this difference. See also the `[[v2-moat-coach-over-the-shoulder]]`
project memory.

---

## The six rules — each is a pass/fail test you build to

### 1. It speaks first — the user never digs.
Every surface opens with the **most important observation, in plain words** — not
a chart or a number the user has to interpret. Exceptions-first.
**TEST:** can a teacher glance at the surface and know the one thing to do,
without clicking or reading a metric? If they have to hunt, it **fails**.

### 2. One thing at a time — the most important thing.
Surface the single most important observation now; hold the rest until asked.
**TEST:** is there one clear priority at the top, not a wall of competing
signals? More than ~3 things fighting for attention at the top = **fail**.

### 3. Plain human language — no geek, no raw metrics. *(CRITICAL — see Language Standard.)*
Say what a great teacher would say out loud, not what the database stores.
> "Leila's ideas are jumping around — worth helping her connect them,"
> **NOT** "cohesion score: 62 / 30th percentile."

**TEST:** would a parent with no education degree understand every word? Would a
busy teacher? If a term only an engineer or data analyst would use appears in
front of a user, it **fails**.

### 4. Notices, suggests, then confirms — never decides for the human.
The coach says "I noticed X — want to try Y?" The teacher stays in charge.
**Observational, NEVER diagnostic. Never auto-act on a student.**
**TEST:** is every recommendation phrased as a suggestion the human accepts or
declines, not a verdict the system has already reached? A surface that decides
for the teacher **fails**.

### 5. Quiet when there's nothing to say.
On-track means **calm, short, minimal** — no manufactured alerts. Silence is a
feature, not empty space to fill.
**TEST:** when a class is doing fine, is the surface calm and brief, or does it
invent things to flag? Noise on a good day = **fail**.

### 6. Not a chatbot. *(Guard against over-build.)*
The coach is mostly **SILENT observation punctuated by RARE, precise, well-timed
input.** Do NOT build a conversational AI tutor that talks constantly — that is
the opposite of the posture and it is what every "AI-powered" EdTech already
does. The best coaching surface says the least.
**TEST:** did a chatty assistant creep in that yaps at the user? If so, it broke
the posture — flag it.

---

## Language Standard — simple, comprehensible human language (NOT geek)

- All user-facing copy uses **plain, everyday human language.** Write like an
  experienced teacher talking to a colleague or a parent: warm, plain, concrete.
- **BANNED in front of users:** metric/stat jargon (**score, percentile, index,
  divergence, threshold, signal, model, algorithm, flag**), engineering terms,
  internal field names, and acronyms a layperson would not know.
- **Numbers:** avoid raw scores in the primary view. If a number must appear,
  pair it with plain-language meaning. **Prefer words over numbers.**
- **Established term rules** (carry forward):
  - **"Mastery"**, not "Band."
  - **Never "adaptive"** in front of users — use **personalized / differentiated**.
  - **Comprehension** is **Reinforce / On Track / Enrich**.
  - Never lead with **"AI-powered."**
  - **"Assignments"**, never "Homework" (resolved 2026-06-20; see below). Legacy
    "Homework" survives only in DB identifiers like `homework_attempts`.
- **Eduflux (BR market):** same posture in natural **PT-BR** — plain
  Brazilian-teacher language, not translated jargon. INEP **"nível"** stays
  (teachers know it), but everything around it is plain. *(Eduflux/pt-BR is
  currently deferred in V2; this rule governs when it is built.)*
- **Applies to every audience surface** (pop-art student; credible teacher /
  parent / admin) and **respects the diagnostic walls:** students and parents get
  growth-framed plain language; risk detail (still plain, **never geek**) stays
  teacher / admin side. Even teacher-side, the diagnostic *construct* may be
  shown but the *word* must be plain (say "her ideas are jumping around," not
  "divergence").

---

## ✅ RESOLVED — "Assignments" governs (2026-06-20)

Barb's brief carried a stale line ("Homework" not "Assignments") — almost
certainly a template carried over from V1. Adjudicated with Marvin on 2026-06-20:
**V2 keeps "Assignments", never "Homework"** in user-facing copy (the legacy term
survives only in DB identifiers like `homework_attempts`), consistent with
`CLAUDE.md` and the prior decision in memory `[[v2-naming-homework-is-assignments]]`.
No surface changes needed for naming; `STRINGS-FOR-BARB.md` proposals use
"Assignments."

---

## How this is enforced (already partly built)

- **Four-audience discipline** + the **`leakGuard`** string-boundary helpers in
  `src/lib/copy/` are the *mechanical* enforcement of Rules 3 & 4 and the
  diagnostic walls (`hasLeak` / `assertNoLeak`). This standard is the *intent*
  those helpers serve; new banned terms here should be reflected in the guard.
- **`MasteryLabel`** is deliberately uncolored/label-only for student/parent.
- Rules 1, 2, 5, 6 are **layout/behavior** tests, not string tests — they are
  reviewed per surface (see the Phase-0 audit) and must be part of every future
  surface review.

## Process rule

New or changed **user-facing strings** go to **`STRINGS-FOR-BARB.md`** as drafts;
**Barb gates all user-facing language** — never ship copy from a build pass
without her sign-off. The six rules above are a standing lens in every surface
code review.
