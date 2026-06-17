# CORE v2 — Master Scope

> **Inteliflow · CORE v2.** Lock every decision here **before Claude Code writes one line.**
> Pre-filled with what four months of V1 taught us and what the live site already commits to.
> Companion file: [`core-v2-workbook.html`](./core-v2-workbook.html) (the shareable, red-line version for Barb).

**Status legend:** ✅ Locked · 🟠 Needs you · 🟣 Barb's call (pedagogy)

**One sentence:** "CORE shows a teacher *how* each student learns and thinks, and turns it into one clear next step."
**Tagline:** Learning Intelligence. Built on pedagogy. Powered by AI.
**Packaging spine:** Essentials **generates** · Pro **reveals** · Enterprise **remembers** — build in that order.
**Core loop:** **Notice → Act → Confirm.**

---

## Decision Log

This table is the live scoreboard. As each open item is settled, move it to ✅ and record the answer.

| # | Section | Decision | Status | Answer |
|---|---------|----------|--------|--------|
| 0 | Big Fork | Lean Essentials-MVP first vs full three-tier rebuild | 🟠 | _pending_ |
| 2 | Roles | All 5 roles in MVP vs student + teacher + thin admin | 🟠 | _pending_ |
| 4a | Engine | Confirm grade-anchored difficulty | 🟠 | _pending_ |
| 4b | Engine | Data threshold where Q4–Q5 start adapting | 🟠 | _pending_ |
| 4c | Engine | CL is per-skill (confirm) | 🟠 | _pending_ |
| 4d | Engine | What's "Super" about Super TELI | 🟠 | _pending_ |
| 5 | Media | Which media in Essentials vs Pro; voice-on-non-reading; monthly limits | 🟠 | _pending_ |
| 6 | Signals | Final signal set + exact gap threshold (V1 used 20+) | 🟠 | _pending_ |
| 7 | Pedagogy | CL states, 12 Strategies, 5 Powers, 4 effort labels, mastery scale, OEQ rubric | 🟣 | _pending_ |
| 8 | Screens | Right MVP screen set | 🟠 | _pending_ |
| 10 | Packaging | Confirm tier gate map; any feature changing tiers | 🟠 | _pending_ |
| 11 | Integrations | GC-only at MVP; SIS connector architected now / shipped P3 | 🟠 | _pending_ |
| 12a | Licensing | Reuse V1 licensing vs redesign | 🟠 | _pending_ |
| 12b | Licensing | Trial = Pro or Essentials level | 🟠 | _pending_ |
| 12c | Licensing | "Downloadable" = cloud signup or installable | 🟠 | _pending_ |
| 14 | Services | Reuse service configs vs clean reset; add/drop services | 🟠 | _pending_ |
| 16 | Look & Feel | Vibrant replaces vs builds on indigo/amber; student-loud/adult-credible split; leaderboard off by default; the one "first 5 min" flow | 🟠 | _pending_ |
| 17 | Sequence | Phasing matches Sept pilot | 🟠 | _pending_ |
| 18 | Success | The 2–3 success metrics | 🟠 | _pending_ |

---

## 0. The Big Fork: How Much Do We Build First? 🟠

- **V1 lesson:** We built 150+ features at once, in parallel; the result was a screen nobody could read. Breadth killed clarity.
- **Recommendation:** Build a lean **Essentials-tier MVP that nails one loop end-to-end** in real classrooms first, then layer Pro (signals) and Enterprise (longitudinal) on top. The tiers give the phasing for free.
- **Decision:** Lean MVP-first (Essentials core), or full three-tier rebuild at once? *Everything below assumes MVP-first.*

## 1. What CORE v2 Is ✅

- Locked one-sentence definition + tagline (above).
- Packaging spine: Essentials generates · Pro reveals · Enterprise remembers → maps onto the core loop; build in that order.

## 2. The Five Roles ✅ (MVP scope 🟠)

Each role gets *one* primary job. A screen that serves two masters serves neither.

| Role | The one thing they come for |
|------|------------------------------|
| **Student** | Am I getting better, and what's my next step? |
| **Teacher** | Who needs me today, and what do I do about it? |
| **Parent** | Is my child okay, in plain words? (no scores dump) |
| **School Admin** | Are teachers and students actually being helped? (adoption + risk) |
| **Platform Super Admin** | Run the platform — schools, licensing, maintenance mode, changelog. |

- **Decision:** All five in the MVP, or start with student + teacher + a thin admin first?

## 3. The Core Loop ✅

- **Notice → Act → Confirm.** Teacher notices who needs help (5-second test), acts (check-in / targeted practice / reteach), and later confirms whether it worked (did mastery move?).
- **V1 lesson:** We captured "notice" data but never closed the loop on "did it work." That close is the most valuable, most missing piece.

## 4. The Generation Engine 🟠 (the heart of CORE)

Pipeline: **Lesson Plan → Quiz (3 MCQ + 2 OEQ) → read cognitive + behavior signals → set CL + detect Learning Strategies → generate Differentiated Assignment + Spark Challenge + Super TELI support** (Strategies & Power Skills baked in).

- **Lesson plan.** One sentence or one upload in → CORE writes the full plan, passage, objectives, key concepts. Review, edit, publish.
- **Quiz: 3 MCQ + 2 OEQ.** MCQs read comprehension fast. The **2 open-ended questions are the engine** — reasoning, critical thinking, and the *specific misconception* live there. AI-graded with a rubric, eval-gated from day one.
- **Grade-anchored difficulty.** Questions generated to the student's **grade level** — a Grade 6 and Grade 12 item on the same skill are not the same difficulty. Hard generation constraint, not an afterthought.
- **Adaptive once there's data (resolved).** Not fixed-vs-adaptive — *sequenced*. Cold-start is a clean fixed 3 MCQ + 2 OEQ at grade level. Once CORE has enough history, **Q4–Q5 reshape in real time** off Q1–Q3 (scaffold down / challenge up).
- **CL = Reinforce / On Track / Enrich.** Three states, each a teacher verb. Set **per skill, not per student.**
- **LS detection** from the 12 Strategies. Quiz *seeds* LS weakly; **behavior signals confirm it** over time. Never a day-one verdict.
- **CL drives generation:** Reinforce → scaffolded work + more Super TELI. On Track → grade-level. Enrich → Spark / stretch + Socratic-only Super TELI.
- **Media-rich outputs.** Every passage, question, and hint can be read aloud; students can speak back; assignments include generated illustrations and diagrams (§5).
- **Decisions:** (a) confirm grade-anchored difficulty + set the data threshold where Q4–Q5 start adapting; (b) confirm CL per-skill; (c) what is "Super" about Super TELI vs today's Teli?

## 5. Media: Audio & Visuals 🟠

Audio and visuals are core to **accessibility** (struggling readers, ELL, younger grades) and **engagement** — not decoration.

- **Audio — read-aloud / TTS.** Passages, questions, Super TELI hints spoken aloud. Built in, every tier.
- **Audio — voice in.** Students speak to Super TELI; speech transcribed. **Voice only on non-reading tasks** (same rule as LIFT — never read a reading-comprehension answer aloud).
- **Visuals — illustrations.** AI-generated images bring lessons/assignments to life.
- **Visuals — diagrams.** Auto-generated diagrams (processes, structures, concept maps) where a picture beats a paragraph.
- **Video.** Richer generated media for select content — heavier cost, so Pro+.
- **Tier-gated limits.** Generous monthly AI-media allowances on Essentials; Pro raises every ceiling. Limits double as the cost guardrail (§14).
- **Decisions:** which media in Essentials MVP vs Pro? Confirm voice-on-non-reading-tasks. Set monthly limit numbers per tier.

## 6. Signals → Actions 🟠

A signal only reaches the screen if it passes the 5-second test *and* resolves to a plain-language action. Everything else lives one tap down.

| Signal | Who | Action it triggers |
|--------|-----|--------------------|
| Comprehension Level (per skill) | Teacher | Reinforce / leave on track / enrich |
| Assignment vs Quiz gap (>~20 pts) | Teacher | Review submissions — integrity, format, or anxiety |
| Effort vs ability (can't yet / needs time) | Teacher | Reteach the concept, or just check in |
| Direction (sliding / climbing) | Teacher + Student | Watch & check in / celebrate the climb |
| Did the intervention work (mastery moved?) | Teacher | Confirm complete, or escalate |
| The specific misconception (from OEQs) | Teacher | Targeted practice on that exact thing |
| Personal growth over time | Student | "You're getting better at X" (vs own past, never peers) |
| One next step, plain words | Student | Do this one thing |

- **V1 credibility risk:** don't claim a learning *strategy* from 5 answers. Comprehension you can read from a quiz; strategy is behavioral and accrues. "Observation supersedes."
- **Decision:** final signal set + exact gap threshold (V1 used 20+).

## 7. Pedagogy Decisions to Lock 🟣 (Barb)

- **CL = Reinforce / On Track / Enrich** — locked on the site, replaces "Tribes." Confirm.
- **12 Learning Strategies:** Goal First, Knowledge Bridge, Quick Look, Text Detective, Question Quest, Explain It, Note Builder, Idea Mapping, Idea Exchange, Think-Talk-Share, Comprehension Crew, Pause & Reflect. Confirm + the rule for prescribing "the next one to try."
- **5 Power Skills ⚡:** Monitor, Think, Research, Communicate, Collaborate. Confirm.
- **4 effort labels:** effortful success / struggling but trying / independent success / independent struggle. Confirm.
- **Mastery scale:** how many levels + human labels ("Mastery," never "Band").
- **OEQ rubric:** what the 2 open-ended questions are scored on + the expected-output set for the eval rig.

## 8. Screen Map (MVP) 🟠

- **Teacher: Today** — 5-second triage. Who needs me, ranked, reason in plain words, one-click action.
- **Teacher: One student** — the story (CL per skill, the gap, effort vs ability, trajectory) + three action buttons. Detail one tap down.
- **Teacher: Create** — one sentence or upload → lesson + quiz; one goal → CORE differentiates.
- **Student: Home** — "you're improving at X" + today's one next step.
- **Student: Do the work** — two-phase assignment (read, then tasks) + Super TELI (voice + read-aloud).
- **Decision:** right MVP screen set? Anything a real teacher needs day one that's missing?

## 9. Data Model ✅ (draft)

Start minimal. Every entity earns its place by feeding a signal in §6.

- **Student · Class · Teacher · School** — roster basics + multi-school from day one.
- **Lesson · Assignment** (goal + per-student entry point) · **Attempt** (work + result + effort signal).
- **Quiz / Quiz attempt** — kept separate so the gap signal works; stores per-question (3 MCQ + 2 OEQ) + misconception.
- **Skill state** — per skill, per student, over time, carrying CL.
- **Snapshots** — weekly, from day one, so trajectory is real not retrofitted.
- **Profile** — observational only; Strategies + Powers accrue. Never assigned upfront.
- **Media asset** — generated illustrations/diagrams/audio, with per-school usage counters for tier limits.
- **License** — school, tier, seat count, term, status (§12).
- **V1 lesson:** capture per-attempt history + weekly snapshots from the start — the trajectory view was a painful retrofit last time.

## 10. Packaging: Three Tiers ✅ (from site; gate map 🟠)

The build must **license-gate features by tier** from day one.

| Tier | Promise | What it adds |
|------|---------|--------------|
| **Essentials $99** | Runs your classroom | Full generation engine: lesson → quiz → differentiated assignments → Super TELI → reteach → parent narrative → gamification → Google Classroom (free) → 5 roles → PDF export → IEP/504-aware generation. Read-aloud + base media limits. |
| **Pro $165** | Shows what's happening now | + Spark Challenges, Risk Index, Assignment-vs-Quiz tracking, reteach effectiveness, cognitive signals, 4 effort labels, concept-gap alerts, "What CORE recommends," bulk grade approval, substitute mode, raised media ceilings + video. |
| **Enterprise** | Learns over time | + full Longitudinal Intelligence, trajectory tab, cohort benchmarking, learning velocity, SIS integration, Pulse/LIFT API, white-label, division-scoped admin, custom reports, CSM. |

- Spark is built into the engine but **gated to Pro+**. Learning Support Intelligence is an add-on for any tier.
- **Decision:** confirm the gate map. Any feature moving tiers in v2?

## 11. Integrations 🟠

| Integration | Tier / phase |
|-------------|--------------|
| **Google Classroom** (SSO, roster, lesson import, one-click launch, grade sync) | **All tiers, free, MVP** |
| **SIS** (Blackbaud, Veracross, ManageBac, Clever/SSO) | **Enterprise** — design connector interface now, ship Phase 3 |
| Spark (internal) | Pro+ — via typed contract, never shared seeds |
| Pulse / LIFT ecosystem API | Enterprise — deferred from pilot |

- **Decision:** confirm GC is the only MVP integration; SIS connector architected up front, shipped Phase 3.

## 12. Licensing, Anti-Piracy & Free Trial 🟠

Carry forward the licensing system already built — it's a moat. Bake in from line one.

- **Per-school, per-tier, per-seat licensing** — annual, September-aligned. Seat count enforced; tier gates features (§10).
- **Anti-copying / anti-piracy** — keep V1's mechanism so the platform can't be cloned or run off-license. Server-validated, not client-trustable.
- **30-day free trial, self-service** — no credit card, 8 demo students pre-loaded, every feature unlocked, onboarding wizard, no cap. Converts to a paid tier or expires cleanly.
- **Maintenance mode** — Super Admin can put CORE read-only with a user-facing banner.
- **Decisions:** (a) reuse V1 licensing as-is or redesign cleaner? (b) Trial = Pro or Essentials level? (c) "Downloadable" = self-serve cloud signup or installable build?

## 13. Tech Architecture & V1 Gotchas ✅

**Stack:** Next.js (App Router, Turbopack) · Supabase · GPT-4o (+ Claude for rubric grading) · Tailwind + shadcn/ui · Vercel.

- Nest API routes under existing paths (Turbopack 404s on new top-level API folders).
- `SECURITY DEFINER` functions for circular RLS; `DROP POLICY IF EXISTS` before create.
- Session client for DB writes; `auth.getUser()` not `getSession()`; `await cookies()`.
- **Eval rig from day one** — real examples + Barb-confirmed expected outputs, auto-checked on every prompt change. Critical for the OEQ grader.
- Couple products by explicit typed contract (the Platform API), never shared DB seeds.

**Carrying V1 forward:** point Claude Code at the **V1 repo as a reference to mine, not a base to patch** — lift the proven pieces into clean v2 files: licensing / anti-piracy, Google Classroom integration, signal math, AI prompts, eval tuples, the 12 Strategies / 5 Powers content, the audio + visual media pipeline. Scope locks the *what/why*; the old repo supplies the *proven how*.

**Hard line:** mine V1 for **logic, data, and patterns — never its visual design.** Proven bones, brand-new skin (§16).

## 14. Services & Infrastructure ✅ (confirm)

Carry forward, configured from day one — not bolted on after launch.

| Service | What it does in CORE |
|---------|----------------------|
| **Resend** | Transactional email — parent narratives, notifications, weekly summary, report cards |
| **Runway** | AI video generation (Pro+ media) |
| **Whisper + TTS** | Voice input + read-aloud — powers §5 audio |
| **GPT-4o + Claude** | Generation + rubric grading of the open-ended questions |
| **Diagram renderer** | Auto-generated diagrams and concept maps |
| **Sentry** | Error monitoring (free-tier optimized, filtered) |
| **PostHog** | Product analytics — server-side, typed allow-list, opaque IDs, no PII |
| **Upstash Redis** | Rate limiting + caching (reliability) |
| **Stripe** | Billing / licensing payments |

- **Cost guardrail:** Runway, image generation, and TTS each cost per use. The per-tier media limits in §5 keep spend bounded — wire usage counters in from the start.
- **Decision:** reuse existing service configs as-is, or clean reset? Any service to add/drop for v2?

## 15. Non-Negotiable Language & Brand ✅

- UI says **"Assignments"** and **"Mastery"** (never "Band").
- **"Personalized / differentiated,"** never **"adaptive."**
- Profiles are **observational, never diagnostic.** "The student is not a data set."
- CL states are **Reinforce / On Track / Enrich.** Strategies = what students *do*; Powers = what they *become*.
- Never lead with "AI-powered."

## 16. Look & Feel — and the Discipline 🟠

- **Visual direction (new for v2):** ditch V1's look entirely. v2 is **vibrant, energetic, pop-art-influenced** — bold color, confident type, playful motion. The opposite of the sterile ed-tech dashboard.
- **Intensity by surface:**
  - **Student screens:** full pop-art energy. Bold blocks, saturated color, big friendly type, playful micro-animations, Super TELI's character.
  - **Teacher / parent / admin screens:** same DNA, dialed for **credibility.** Confident and modern, never cartoonish — a clownish teacher dashboard kills the sale.
  - **Bold skin, disciplined bones.** Spend boldness on a signature element; keep information design calm so the 5-second test still works.
  - **Vibrant ≠ unreadable.** Bold color must still hit WCAG AA contrast.
  - **Avoid the generic AI look.** Specific, intentional palette — not stock Memphis squiggles.
- **Starter tokens (react to, not final):** electric palette — vivid violet + hot coral + acid lime accents over clean near-white, deep ink text — or a louder evolution of the current indigo/amber. Expressive geometric display face + highly legible body face. Motion with purpose.
- **The rest of "better" is discipline:** time-to-first-value < 5 min · 30-minute implementation · defaults over settings · one screen/one job/one action · healthy engagement (You-vs-4-weeks-ago default, leaderboard off by default) · plain language is the product · trust as a feature · mobile + accessible by default.
- **Decisions:** vibrant *replaces* or *builds on* indigo/amber? Confirm student-loud / adult-credible split. Leaderboard off by default? Pick the one "first 5 minutes" flow to obsess over.

## 17. Build Sequence 🟠

| Phase | What ships |
|-------|------------|
| **P0** | This sheet, fully locked. (We're here.) |
| **P1 — Essentials core** | The engine (§4) end-to-end with read-aloud + visuals; Teacher Today + One Student + Create; CL + gap + effort signals; Google Classroom; licensing + 30-day trial; 5 roles thin. |
| **P2 — Pro / close the loop** | Spark; Risk Index; cognitive signals; video media; "did it work" confirmation; student trajectory; parent dashboard. |
| **P3 — Enterprise** | Longitudinal layer; SIS connectors; cohort benchmarking; white-label; ecosystem API. |

- **Decision:** does this match the pilot timeline (Sept start)?

## 18. How We'll Know It Has Value 🟠

- **V1 lesson:** "We don't even know if it has value" — because we never defined it upfront.
- **Leading signs:** teachers log in weekly without nagging · teachers take a CORE-recommended action · login→insight < ~30s, first differentiated assignment < 5 min.
- **Proof it worked:** flagged students' assignment grades trend up · the Assignment-vs-Quiz gap narrows for students we intervened on · teachers say, unprompted, "this changed what I did in class."
- **Decision:** pick the 2–3 metrics that define success — those become the pilot scoreboard.

## 19. Explicitly Out of Scope (v2 pilot) ✅

- Portuguese / Brazil localization (Pulse track).
- LIFT integration beyond the pre-populate handoff.
- Custom white-label + advanced longitudinal dashboards (Enterprise, Phase 3).
- Anything that doesn't serve Notice → Act → Confirm.
