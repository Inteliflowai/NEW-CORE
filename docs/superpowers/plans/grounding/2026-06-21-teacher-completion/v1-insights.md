# V1 Teacher INSIGHTS (Class-Level Analytics/Insights Screen)

## Overview
V1's teacher insights screen is a **unified, disclosure-based class analytics hub** merged on 2026-04-27 from separate /teacher/signals and /teacher/reports pages. It presents class-level data in three layers: a "calm read" summary (always visible), collapsible charts & breakdowns, and a custom report builder—designed to reduce cognitive overload vs. raw stats.

---

## Screen Structure (Top to Bottom)

### 1. Header
- **Title**: "Class Insights"
- **Subtitle**: "Trends on your class right now"
- **Context**: Shows selected class name

### 2. **CALM READ** (Always Visible)

#### a) **ClassSnapshot**
Renders three count pills:
- **Red pill** (Needs Reinforcement): Count of students in "reteach" band
- **Amber pill** (On Track): Count in "stretch" band  
- **Green pill** (Ready to Enrich): Count in "advanced" band
- **Summary line** (one of):
  - "No signals yet" (when no student data)
  - "No urgent flags today — class is steady" (zero reteach)
  - "{n} student could use a closer look; the rest are on track or ready to enrich" (singular/plural)

**Data source**: /api/teacher/briefing/prefetch -> computeTribes() -> returns { reteach, stretch, advanced } arrays filtered by selected_class.id. Each array contains TribeStudentLite objects with signal_strength and signal_summary.

**File**: pp/(dashboard)/teacher/class-insights/page.tsx lines 206–251

---

#### b) **WhatThisMeans** (Conditional)
A **calm 1–3 line class-level insight** (quiet when nothing notable):

Renders bullets like:
- "{reteach} of {total} students need extra support today — the latest concept may need a class-wide reteach." (if reteach ≥ 40% of total)
- "Most of the class is ready to enrich — they're ready for deeper work on the same topic." (if advanced ≥ 50%)
- "The class is split between students who need reinforcement and students ready to enrich — differentiated grouping will help." (if both reteach and advanced present, gap < 15%)

**Data source**: Computed client-side from reteach/stretch/advanced counts (lines 61–86).  
**Design note**: Avoids prescriptive language; observation-based per coach posture.

**File**: pp/(dashboard)/teacher/class-insights/page.tsx lines 254–263

---

#### c) **ClassStrategyPatterns**
(Phase 3.x Piece 2 — 2026-05-14 lock)

**Purpose**: Aggregate-level "heat-map of pedagogical activity" — shows which Strategies and Powers appear most frequently across recent grading prose (trailing 30 days).

**Renders**:
- Title: "Strategies showing up across the class"
- Top 5 strategies: "Strategy Name · {count}× across the class"
- Top 5 powers: "Power Name · {count}× across the class"
- Honest framing: not "every student uses these," but "patterns observed in this week's grading."

**Threshold**: Only renders if scannedBlocks ≥ 10 to avoid over-claiming from thin data. Silently skips if no flagged strategies/powers.

**Data source**: /api/teacher/classes/{classId}/strategy-usage -> returns { strategies: [{ name, count }, ...], powers: [...], scannedBlocks }.

**File**: components/teacher/ClassStrategyPatterns.tsx lines 39–71

---

#### d) **ClassSkillFocusPanel**
(Job 5 gap-closer — class-level per-skill rollup)

**Purpose**: "Who's weak where, by skill?" — shows skills where the MOST students need attention.

**Renders**:
- Title: "Skills requiring attention"
- Up to 8 skills (sorted by need):
  ~~
  Skill Name   [BNCC codes if present]   {n} of {m} students need attention
  ~~
- Only appears if flagged skill data exists; silent when most skills are "insufficient_data" (early in course).

**Data source**: /api/teacher/skill-states/class?classId={id} -> returns array of skills with counts: { needs_different_instruction, needs_more_time, on_track, ready_to_extend, insufficient_data }.

**File**: components/teacher/ClassSkillFocusPanel.tsx lines 39–91

---

## Summary

**V1's teacher insights is a tiered, quiet-by-design hub—calm summary always visible, heavy charts & builder tucked behind collapsible disclosures. It surfaces class-level patterns (band distribution, strategy heat-map, per-skill needs, top 5 priority students) and suggests one actionable next step per class state, with all numeric values hidden behind band vocabulary to enforce the four-audience boundary.**

Grounding complete; ready for V2 spec.
