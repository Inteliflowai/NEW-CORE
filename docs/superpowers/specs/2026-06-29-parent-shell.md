# Parent Shell (C) — Design Spec

**Status:** DECISIONS LOCKED (Marvin, 2026-06-29) — ready for writing-plans.
**Grounding:** V2 grounding (2026-06-29) — all existing parent files verified against live code.
**Memory:** [[v2-parity-program-meat-and-potatoes]], [[v2-epic4-parent-dashboard]], [[v2-backlog-status-2026-06-25]].

---

## 1. Context

Epic 4 (parent dashboard + AI narrative, migration 0029, `012154e`) is fully live. The parent app now has:
- Narrative dashboard with AI Learning Summary + conversation starters + "see more detail" (sparkline, normalized bars, high-fives)
- Printable report (`/parent/children/[studentId]/report`)
- 2-link nav: Dashboard + Reports

What's MISSING to make the parent app feel complete for a pilot parent:

| Missing | V1 had it? | Gap type |
|---|---|---|
| `/parent/progress` page — trend + upcoming assignments + skill strengths | ✅ | V1-parity page |
| Contact Teacher card on dashboard | ✅ | V1 had a compose modal |
| Help at Home card (conversation starters as a prominent card) | ✅ (modal in V1) | V1 feature |
| Celebrate card (latest high-five note surfaced) | ✅ | V1 feature |
| Nav: Progress link | ✅ | Part of V1 nav |
| Settings page (notification prefs) | ✅ | Needs migration + delivery system |
| `shared_with_parent` toggle on student notes | ❌ (V2 innovation) | No schema yet |

---

## 2. Proposed Scope (C: Parent Shell)

**In scope — no migration:**

### 2a. `/parent/progress` page
- **Grade trend:** reuse `loadStudentGrowth` (already written for student B epic) — direction words + digit-free sparkline. Gated: ≥3 graded assignments for a direction sentence (same `classifyDir` threshold). Cold-start: "Building your child's learning history — keep checking back."
- **Upcoming assignments:** query `assignments WHERE student_id IN (...) AND due_at > now() ORDER BY due_at ASC LIMIT 10`. Show: title + due date label ("Due tomorrow", "Due Wednesday" — human-readable, no digits in date). No grade info (four-audience: parents don't see grades on dashboard). If empty: "No upcoming assignments right now — good place to be!"
- **Skill strengths:** reuse `studentSkillLabel` (from B epic). Top 3 skills where `state IN ('on_track','ready_to_extend')` and `observation_count >= 2`. Show as a simple list: skill name + coach label (Solid / Excelling). If < 1: quiet (don't show section). Section header: "Areas where [child first name] is doing well".
- **Nav: add "Progress" link** to `(parent)/layout.tsx`.

### 2b. Dashboard action cards (3 deferred items from Epic 4 spec section 5)

**Contact Teacher card:**
- Show: teacher's display name + a `mailto:` link to their email (from `users.email` via the class enrollment). No in-app inbox needed.
- How: `SELECT u.display_name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.class_id = <class_id> AND u.role_in_school IN ('teacher','co_teacher') LIMIT 1`. Use admin client.
- Render: `Card` with "Reach out to [Teacher Name]" headline + "Send an email →" button (mailto: link). If no teacher found: section hidden.
- Binding: no DB change, no message stored — a mailto link.

**Help at Home card:**
- The conversation starters already exist on the dashboard (the `ConversationStarter` component shows one question). Surface this as a **dedicated card** with a short intro line ("Questions to start a conversation tonight") + show up to 3 starters with a clipboard-copy button per starter.
- Reuses the cached `conversation_starters[]` array already in the narrative cache — no new query.
- Render: `Card tone="brand"` with starters list. No separate modal needed.

**Celebrate card:**
- Surface the latest high-five note as a warm standalone card on the dashboard: "Something your teacher wanted you to know" + the note text.
- Data: already loaded by the existing dashboard (read-only high-fives query). Just add a card that shows the most recent one. If none: card hidden.
- Render: `Card tone="brand"` with a subtle "from your teacher" label.

**Out of scope (defer):**
- Settings page + `notification_prefs` migration: no notification delivery system exists; a settings page with non-functional toggles is misleading. Defer to a future notifications epic.
- `shared_with_parent` toggle: needs migration, no V1 precedent. Defer.
- In-app message form (Contact Teacher): `mailto:` is sufficient for pilots. Upgrade if pilots request it.
- Full V1 8-tab reports page with CSV export: V2 report (printable direction-words-only) is adequate for beta.

---

## 3. Four-Audience Discipline (binding)

- **Progress page:** NO grade digits. Trend = direction words only ("climbing / steady / just getting started"). Upcoming = title + due-date label only (no grade, no score, no band).
- **Skill strengths:** show `studentSkillLabel()` output only (Solid / Excelling). Never show raw state enum, CL verb, or observation count.
- **Dashboard cards:** Contact Teacher and Help At Home copy go to `STRINGS-FOR-BARB.md`. Celebrate card shows teacher's note_text verbatim (teacher already wrote it for the student — safe) + a header Barb gates.
- `assertNoLeak` + `assertNoBannedWord` called on any dynamically composed strings (the lead sentence on the progress page, the cold-start lines).
- Parent guard (`hasParentLeak`) from Epic 4's `parentGuard.ts` already exists and applies to any AI text.

---

## 4. Decisions (LOCKED — Marvin, 2026-06-29)

**D1 — Contact Teacher: `mailto:` link.** Plain `<a href="mailto:...">` using teacher's `users.email`. No in-app inbox, no DB change.

**D2 — Upcoming assignments on Progress page: INCLUDE.** Show title + human-readable due-date label (no grades, no scores, four-audience safe).

**D3 — Celebrate card: INCLUDE.** Show latest high-five note verbatim as its own warm card. Hidden when no notes exist.

**D4 — Help at Home card: INCLUDE.** Make conversation starters a dedicated card with clipboard-copy buttons per starter.

---

## 5. Build shape (once decisions locked → writing-plans)

**Estimated: 4 tasks, no migration, ~1 day.**

1. **Loaders + helpers** — `loadParentProgress` (grade trend + upcoming assignments + skill strengths) + upcoming-date formatter (pure, import-safe)
2. **Progress page** — `(parent)/parent/progress/page.tsx` + components (trend card, upcoming card, skills card) + nav link + leak tests
3. **Dashboard action cards** — Contact Teacher card, Help At Home card (starters with copy), Celebrate card — added to `parent/dashboard/page.tsx`
4. **Barb strings + tests** — `STRINGS-FOR-BARB.md §Parent Shell` + `growth.leak.test` for progress page + dashboard leak gate update

Gates: tsc 0, vitest green, build 0 (a11y + tokens). Playwright preview before merge.

---

## 6. Binding constraints

- All existing Epic 4 constraints carry forward (four-audience, parentGuard, never import `loadStudentSignals`, admin client + IDOR guard per child).
- Token classes only (text-fg, text-fg-muted, text-brand, Card tone prop). No hardcoded hex.
- `assertNoLeak` + `assertNoBannedWord` on all dynamically-composed parent-visible strings.
- Upcoming assignment query: admin client + explicit `student_id IN (...)` filter (IDOR safe).
- Teacher email lookup: admin client + `class_id` scoped + teacher-role filter only (never expose all users).
- Contact Teacher `mailto:` link: plain `<a href="mailto:...">` — no server-side email send.
