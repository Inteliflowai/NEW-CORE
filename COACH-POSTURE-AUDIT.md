# COACH-POSTURE-AUDIT.md — Phase-0 read-only audit (2026-06-20)

> Audits the current CORE V2 surfaces against the six tests in `COACH-POSTURE.md`.
> **Read-only pass — no product code was changed.** Proposed copy lives in
> `STRINGS-FOR-BARB.md` as drafts. Method: 5 parallel read-only surface auditors
> (student / teacher-core / teacher-secondary / parent / admin) → opus synthesis +
> completeness critic, all citing real files.

## The one-line verdict

**CORE today is a quiet, well-mannered dashboard that occasionally remembers to
speak like a coach** — the voice is real on **Today** and the **student drill-in**,
but it goes silent (or borrows the student's voice) the moment you leave the two
flagship screens, and where it does speak it still reaches for the number when a
great coach would just say the plain thing. It's **one EmptyState fix and one
words-over-numbers pass** away from feeling like it's actually watching over your
shoulder rather than waiting for you to come look.

**Dominant failure mode is OMISSION (stubs that don't speak first) and REGISTER
(numbers where words belong) — not commission.** Notably: **no chatbot-creep
anywhere** (the product is correctly silent-by-default), and almost no
"decides-for-teacher." That's the right foundation.

---

## Ranked fix list — worst offenders first

| # | Sev | Surface · Screen | File | Break | Why it hurts the coach feel |
|---|-----|------------------|------|-------|------------------------------|
| 1 | 🔴 high | Student · Shell | `(student)/layout.tsx` | dead nav link | "Growth" nav link 404s (route unbuilt). On the surface meant to feel encouraging, a dead door breaks trust on contact. **Remove until Growth ships.** |
| 2 | 🔴 high | Teacher secondary · 7 screens | `components/core/EmptyState.tsx` | wrong-voice empty state | All 7 stubs show the **student-addressed** default "Keep going — more practice builds a clearer picture." to a *teacher*. Fails "speaks first" 7× from one default. **Highest-leverage fix.** |
| 3 | 🟡 med | Teacher core · Today / Roster / drill-in | `lib/copy/triageWhySentence.ts` | metrics-first | Daily surfaces lead with raw % + point-gaps ("Quiz average is 48% … 22 points below"). The construct is hidden but the numbers put CORE in the analyst's chair. |
| 4 | 🟡 med | Teacher core · Challenges | `challenges/_components/ChallengeCard.tsx` | metrics-first + jargon | "Transfer: strong (82%)" — raw % glued to a word that already carries the meaning, under jargon label "Transfer". |
| 5 | 🟡 med | Teacher core · Challenges | `challenges/page.tsx` | no opener | Opens on a flat card list with no leading observation (unlike Today/Roster). Waiting dashboard, not a coach. |
| 6 | 🟡 med | Student · Assignments list | `(student)/student/assignments/page.tsx` | wall-of-signals | Bare "My Assignments" h1 over a flat 200-item list, no prioritized "start here", no warm line. Student must self-triage. |
| 7 | 🟡 med | Super-Admin · Schools | `(super-admin)/schools/_components/SparkEnableButton.tsx` | geek-jargon | Dumps `JSON.stringify(json.steps)` at the operator on error — a system talking to itself in front of a human. |
| 8 | 🟢 low | Super-Admin · Provision | `(super-admin)/provision/page.tsx` | geek-jargon | "Credentials (share once — not stored in logs):" leaks a dev/security note; raw UUID under "School ID:". |
| 9 | 🟡 med | Teacher core · Roster | `(teacher)/roster/page.tsx` | wall-of-signals | ClassPulseStrip competes with the focus cards for primacy; a teacher who came to act reads past a chart. Demote pulse to detail-on-demand. |
| 10 | 🟢 low | Teacher core · Roster legend | `roster/_components/SignalLegend.tsx` | banned term | "Mastery **bands**" ("Band" is banned) / "Suggested actions". Low blast radius (inside a legend). |
| 11 | 🟢 low | Teacher core · drill-in | `students/[studentId]/page.tsx` | jargon labels | "Reteach history" / "At risk?" → "After the reteach" / "Worth watching?". |
| 12 | 🟢 low | Teacher core · drill-in | `students/[studentId]/_lib/priorityCta.ts` | borderline decides | "Review what's going on" with no visible reasoning. Add "I noticed some patterns worth a closer look" → notice-then-suggest. |
| 13 | 🟡 med | Student · Dashboard | `(student)/student/dashboard/page.tsx` | stub, no voice | "Your CORE space is being set up" waiting room. OK as a stub; flagged so the built screen opens with the one observation, not a metric grid. |
| 14 | 🟢 low | Teacher secondary · Insights | `(teacher)/insights/page.tsx` | analytics framing | Bare "Insights" h1 + "INSIGHTS & TOOLS" group label, no kicker. "What your class is showing" would ground it. |
| 15 | 🟢 low | Multiple shells | `components/core/RoleLayout.tsx` | *(token discipline)* | Arbitrary `[var(--..)]` classes instead of Tier-2 tokens across student/parent/super-admin/school-admin shells. Not a posture issue — a `CLAUDE.md` token violation; one consolidated sweep. |
| 16 | 🟢 low | Student · Assignments naming | `(student)/student/assignments/page.tsx` | ~~naming-pending~~ **resolved** | Logged during audit; **resolved 2026-06-20 → "Assignments" stays.** No flip. |

---

## Surface-by-surface (the six tests)

| Surface | Screen | Passes | Fails | Top violation |
|---|---|---|---|---|
| Student | Dashboard | plain, quiet, not-chatbot | **speaks-first** | Empty "space is being set up" waiting room (stub) |
| Student | Assignments list | plain, suggests, quiet, not-chatbot | **speaks-first, one-thing** | Flat 200-item queue, no prioritized first item |
| Student | Assignment detail | one-thing, plain, suggests, quiet, not-chatbot | **speaks-first** | Title + raw instructions, no framing (stub until Epic 2) |
| Student | SparkLaunchCard | **all six** | none | Closest thing to a coach voice on the student side |
| Student | Shell | plain, not-chatbot | **quiet (dead link)** | "Growth" nav link 404s |
| Teacher core | Today | speaks, one-thing, suggests, quiet, not-chatbot | **plain** | triageWhySentence raw % + point-gaps |
| Teacher core | Roster | speaks, suggests, quiet, not-chatbot | **one-thing, plain** | Pulse strip competes for primacy; raw-% triage |
| Teacher core | Spark Challenges | one-thing, suggests, quiet, not-chatbot | **speaks-first, plain** | "Transfer: strong (82%)"; no opening callout |
| Teacher core | Student drill-in | speaks, one-thing, suggests, quiet, not-chatbot | **plain** | divergencePhrase raw %s + "+12 pts"; jargon labels |
| Teacher core | Shell (sidebar/topbar) | plain, quiet, not-chatbot | none | Clean, appropriately silent chrome |
| Teacher 2° | Gradebook | quiet, not-chatbot | **speaks-first, plain** | Student-addressed EmptyState default |
| Teacher 2° | Alerts | quiet, not-chatbot | **speaks-first, plain** | Same — teacher has no idea what an alert is |
| Teacher 2° | High Fives | quiet, not-chatbot | **speaks-first, plain** | Same — no framing of what a "high five" is |
| Teacher 2° | Insights | quiet, not-chatbot | **speaks-first, plain** | Same + bare "Insights" h1 |
| Teacher 2° | Lesson Library | plain, quiet, not-chatbot | **speaks-first** | Same default; no "upload to start" direction |
| Teacher 2° | Quiz Library | plain, quiet, not-chatbot | **speaks-first** | Same default; no direction |
| Teacher 2° | Upload | plain, quiet, not-chatbot | **speaks-first** | Same default; no "drop a file here" guidance |
| Parent | Dashboard | plain, quiet, not-chatbot | none (rest n/a) | Unbuilt stub — passes trivially |
| Parent | Layout | plain | — | Token discipline; nav links point at unbuilt routes |
| Admin | School-admin dashboard | plain, quiet, not-chatbot | **speaks-first** | "space is being set up" stub; product self-reference |
| Super-Admin | Provision | one-thing, quiet, not-chatbot | **plain** | "not stored in logs" dev note; raw UUID |
| Super-Admin | Schools list | one-thing, suggests, quiet, not-chatbot | **plain** | `JSON.stringify(steps)` dumped on error |
| Super-Admin | Layout shells | plain, quiet, not-chatbot | none | Token discipline only |

---

## Cross-cutting patterns (fix once, clear many)

- **A — Wrong-voice empty state (highest leverage):** the shared `EmptyState`
  default is the top violation on **7** teacher screens. One call-site pass clears
  all 7. → fix #2.
- **B — Metrics-first via 2 copy helpers:** `triageWhySentence` + `divergencePhrase`
  carry raw percentages into Today, Roster, **and** the student drill-in. The
  "teacher-only by design" grandfathering *is* the posture break. Two files, three
  screens. → fixes #3, #4.
- **C — Dead nav links across 3 route groups:** `/student/growth`,
  `/parent/children`, `/parent/reports`, `/admin/school`, `/admin/teachers` are all
  linked in shells with no `page.tsx`. "Dead link" is a cross-cutting
  manufactured-noise pattern, not a one-off. → fix #1 + a shell sweep.
- **D — Token discipline:** arbitrary `[var(--..)]` classes across student/parent/
  super-admin/school-admin shells + `RoleLayout`. Not a posture issue — a `CLAUDE.md`
  violation worth one consolidated sweep. → fix #15.

## Coverage gaps (what this pass did NOT cover — recommend a follow-up)

1. **Auth surfaces out of scope:** `/login`, `/set-password`, `/logout`,
   `/trial-expired`, `auth/callback` were not posture-checked. Login on-glass copy
   and the trial-expired message are **first-impression coach moments** — worth a
   dedicated pass.
2. **Shared core components' own strings unaudited:** `MasteryLabel`, `RiskBadge`,
   `CLBadge`, `GrowthMotif`, `StatCard` were read only to confirm they don't leak to
   student/parent. Their teacher-facing output strings (band labels, risk phrasing,
   CL verbs) deserve a direct copy audit against the "Mastery not Band / plain words
   for constructs" rule.
3. **Signal-assembly libs unread:** `loadRosterSignals`, `loadStudentSignals`,
   `sortFocusGroup`, `loadChallenges` shape *which* signals surface and in what
   order — the substance of the "one thing at a time" test. A render-layer-only
   audit can miss a wall-of-signals that originates in the data layer.

## Scope

No product code changed this pass (read-only Phase-0 per Barb's directive). The
standard is `COACH-POSTURE.md`; the copy drafts are `STRINGS-FOR-BARB.md`. When we
build: staging only, Barb gates all user-facing language, diagnostic walls hold.
