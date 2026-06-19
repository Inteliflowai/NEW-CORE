# V1 → V2 Port Guide: Demo Seed + Trial Provisioning

**Grounding date:** 2026-06-19
**Spec target:** Plan 4b §4.2 (demo seed) + §4.3 (pilot/trial provisioning)
**V1 sources read:**
- `lib/trial/provisionTrial.ts`
- `lib/trial/seedTrialDemoData.ts`
- `lib/trial/logTrialEvent.ts`
- `lib/licensing/trial.ts`
- `scripts/seedDemo.mjs`
- `app/api/public/trial/signup/route.ts`
- `lib/demo/seedCoreDemo.ts`
- `lib/supabase/server.ts`
- `.env.example`

**V2 sources read:**
- `supabase/migrations/0001_identity_roles.sql`
- `supabase/migrations/0003_lessons_quizzes.sql`
- `supabase/migrations/0004_assignments_homework.sql`
- `supabase/migrations/0006_snapshots.sql`
- `supabase/migrations/0007_licensing.sql`
- `supabase/migrations/0011_signals.sql`
- `src/lib/supabase/server.ts`
- `src/app/api/public/trial/signup/route.ts` (stub)
- `docs/superpowers/specs/2026-06-18-core-v2-p4b-foundation.md` §4.2–4.3

---

## 1. Service-Role Key — Critical Rename

| V1 env var | V2 env var |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` |

**V1** (`lib/supabase/server.ts:51`): `createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)`

**V2** (`src/lib/supabase/server.ts:30`): `createClient(url, process.env.SUPABASE_SECRET_KEY!)`

Every V2 script and library that calls `createAdminSupabaseClient()` inherits this automatically. But the new `scripts/seedDemo.mjs` must also read `SUPABASE_SECRET_KEY` directly when bootstrapping the client before calling library functions — V1's `seedDemo.mjs` read `SUPABASE_SERVICE_ROLE_KEY` inline at line 10. Do not copy the V1 env-var literal.

The V2 anon/publishable key env var also differs:
- V1: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- V2: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

---

## 2. Auth-User Creation Pattern (portable)

Both V1 and V2 share the same two-step pattern. There is no DB trigger syncing `auth.users → public.users`; the caller must INSERT the `users` row after every `createUser`.

**V1 pattern** (`scripts/seedDemo.mjs:63-74`, `lib/trial/provisionTrial.ts:101-126`):
```ts
// Step 1: Auth user
const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name },
});

// Step 2: Public profile row — always manual, never trigger-synced
await admin.from('users').insert({
  id: authUser.user.id,
  full_name,
  email,
  role,               // 'teacher' | 'student' | 'parent' | 'school_admin'
  school_id: schoolId,
  // trial-specific additions:
  is_trial_user: true,
  trial_school_id: schoolId,
});
```

**V2 adaptation:** identical shape. The `users` table in 0001 has all these columns. The INSERT must happen in the same function, not as a post-hook.

**Idempotency contract (seed):** V1's `seedDemo.mjs` checked `supabase.from('users').select('id').eq('email', email).maybeSingle()` — if a `users` row exists, reuse its `id` and skip `createUser`. V2's spec (§6 open question 1, resolved) chooses **reconcile-on-seed**: look up the auth user by email, ensure the `users` row exists with an upsert, never duplicate. Implementation: `supabase.auth.admin.getUserByEmail(email)` → use returned `id`; `users` INSERT uses `upsert({ onConflict: 'id' })`.

---

## 3. `provisionTrial` — Order of Operations (V1 → V2)

V1 source: `lib/trial/provisionTrial.ts`. V2 must follow the same order but with schema adaptations noted below.

| Step | V1 action | V2 adaptation |
|---|---|---|
| 1 | INSERT `schools` with `is_trial`, `trial_started_at`, `trial_expires_at`, `trial_status='active'`, `trial_plan`, `trial_source`, `demo_mode=false` | Same columns exist in V2 `0001_identity_roles.sql`. Identical INSERT. |
| 2 | `auth.admin.createUser` for the requester (teacher) with `email_confirm: true, user_metadata: { full_name }` | Identical. |
| 3 | INSERT `public.users` for the teacher with `role='teacher'`, `school_id`, `is_trial_user=true`, `trial_school_id` | Same columns in V2 `0001`. Identical INSERT. |
| 4 | Loop: create 3 additional demo role accounts (`student`, `parent`, `school_admin`) via `auth.admin.createUser` + INSERT `public.users` | Identical. V1 used synthesised emails like `demo-student1@trial-{shortId}.core.com`; V2 can keep this pattern. |
| 5 | Build a `credentials` object (email + password per role) | No schema change. |
| 6 | UPDATE `schools.trial_credentials` (JSONB) with all four role credentials | Same column in V2. Identical UPDATE. |
| 7 | Call `seedTrialDemoData({ admin, schoolId, schoolIdShort, teacherId, firstStudentId, parentId, password })` | See §4 below for seed adaptations. |
| 8 | INSERT `trial_events` with `event_type='trial_signup'` | `trial_events` exists in V2 `0007_licensing.sql`. Same schema, same `event_type` enum value. |
| **NEW in V2** | INSERT `school_licenses` with `tier='professional'`, `status='trialing'`, `student_limit`, `trial_starts_at`, `trial_ends_at`, `trial_converted=false` | **V1 provisioning did NOT insert `school_licenses`** — that was done by a separate `lib/licensing/trial.ts:provisionTrial()`. In V2 these must be fused: the single `provisionTrial` function must insert both the `schools` trial columns AND the `school_licenses` row. V2 spec §4.3 step 1 explicitly requires both. |
| **NEW in V2** | Optionally call `ensureSparkProvisioning` (insert `platform_api_keys` row for spark) | The V1 licensing layer had this. V2 plan does not explicitly call for it in 4b, but `platform_api_keys` is already in V2 (0008). Low risk to omit in the 4b implementation; add only if the SPARK gate is tested in 4b. |

**V1 clean-up on partial failure:** V1 `provisionTrial.ts:110-112` deleted the school row if auth-user creation failed (`admin.from('schools').delete().eq('id', schoolId)`). Carry this defensive pattern to V2.

---

## 4. `seedTrialDemoData` — Input Signature + Portable Structure

**V1 input type** (`lib/trial/seedTrialDemoData.ts:41-49`):
```ts
export interface SeedTrialDemoDataInput {
  admin: SupabaseClient;
  schoolId: string;
  schoolIdShort: string;   // schoolId.slice(0, 8) — used in student email generation
  teacherId: string;
  firstStudentId: string | null;   // Alex Rivera — already created in provisionTrial
  parentId: string | null;
  password: string;
}
```
V2 should keep this exact interface; the spec §4.3 says "matching V1's input type and behavior."

**Order of operations within `seedTrialDemoData`** (V1 steps 1–12):

| Step | V1 action |
|---|---|
| 1 | Create auth users for students 2–8 (`auth.admin.createUser` + `users` INSERT each) |
| 2 | INSERT `classes` row |
| 3 | INSERT `enrollments` for all 8 students (including the pre-created student 1) |
| 4 | Link parent → Alex Rivera: `users.parent_id = parentId` + `guardians` upsert |
| 5 | INSERT `lessons` row with `parsed_content` JSONB |
| 6 | INSERT `quizzes` row + INSERT 5 `quiz_questions` (3 MCQ + 2 OEQ) |
| 7 | INSERT `quiz_attempts` for each student (profile-driven `score_pct`, `mastery_band`) |
| 8 | INSERT `assignments` + `homework_attempts` per student (band-differentiated content) |
| 9 | UPSERT `student_model` — **see §5 below (table does not exist in V2)** |
| 10 | UPSERT `student_gamification` — **see §5 below (table does not exist in V2)** |
| 11 | UPSERT `signal_aggregates` — **see §5 below (table does not exist in V2)** |
| 12 | INSERT `alerts` for Darius + Emma — **see §5 below (table does not exist in V2 yet)** |

---

## 5. Critical Schema Gaps — Tables That Do NOT Exist in V2

These are the V1 tables written by the seeder that have no counterpart in V2 migrations 0001–0011.

### 5a. `student_model` (V1 step 9)

V1 wrote to `student_model` with columns:
- `student_id` (conflict key)
- `school_id`
- `dominant_style`
- `preferred_scaffold_level`
- **V1 original:** `avg_score_trend`, `score_history[]` (pre-split)
- **V1 later (migration 055 comment):** `avg_quiz_score_trend`, `avg_hw_grade_trend`, `quiz_score_history[]`, `hw_grade_history[]` (post split)
- `total_quizzes`, `total_homework`
- `consistency_score`, `consistency_label`
- `dominant_effort_pattern`
- `avg_hints_per_assignment`
- `computed_mastery_band`, `computed_mastery_score`
- `strength_topics[]`, `struggle_topics[]`

**V2 equivalent:** `student_model_snapshots` (0006). It is a time-series table keyed on `(student_id, snapshot_date)`, not a single mutable row. Columns that do overlap: `mastery_band`, `learning_style`, `consistency_label`, `dominant_effort_pattern`, `preferred_scaffold_level`, `avg_score`, `total_quizzes`, `total_homework`, `strength_topics[]`, `struggle_topics[]`, `risk_score`, `avg_hints_per_attempt`, `divergence_score`, `divergence_direction`, `consistency_score` (added in 0011), `improvement_4w`.

**V2 adaptation:** V1's single upsert becomes one or more `student_model_snapshots` INSERT rows per student (at minimum 4 rows per student per spec §4.2 to give `GrowthMotif` enough data). `onConflict: 'student_id,snapshot_date'`. There is no V2 `student_model` table; do not try to insert into it.

### 5b. `student_gamification` (V1 step 10)

V1 columns: `student_id`, `school_id`, `xp_total`, `level`, `level_label_elem`, `level_label_middle`, `level_label_high`, `streak_current`, `streak_longest`, `badges_earned[]`, `total_quizzes_completed`, `total_homework_completed`, `teli_theme`, `teli_mood`.

**V2 equivalent:** no migration creates this table in 0001–0011. The V2 spec §4.2 does not list it as a seed target. **Omit from V2 trial seed.** If gamification is added in a later plan, the seed should be extended then.

### 5c. `signal_aggregates` (V1 step 11)

V1 columns: `student_id`, `school_id`, `risk_score`, `risk_level`, `hw_quiz_divergence`, `reteach_effectiveness`, `avg_quiz_score`, `avg_hw_score`, `total_submissions`.

**V2 equivalent:** no migration creates a `signal_aggregates` table. Risk/divergence/effort signals live in `student_model_snapshots` (0006) and are computed by the signals engine. **Omit from V2 trial seed.** Instead, write snapshot rows (step 5a above) with `risk_score`, `divergence_score`, `divergence_direction` populated; the signals route reads those.

### 5d. `alerts` (V1 step 12)

V1 columns: `school_id`, `class_id`, `student_id`, `severity`, `trigger_reason`, `status`, `urgent`.

**V2 status:** no migration in 0001–0011 creates an `alerts` table. **Omit from V2 trial seed unless/until the Alerts migration lands.** The spec does not include an Alerts migration as a 4b prerequisite; it is a screen-level concern. Insert defensively (try/catch) if the table exists at seed time, but do not make the seeder fail-fast on its absence.

---

## 6. Engineered Student Signal Profiles

The 8-student cast is identical in V1's `seedTrialDemoData.ts` and `seedDemo.mjs`. The signal columns that drive band/effort/divergence/volatility (what the V2 spec calls "every screen case must render") are:

| Student | Band | Consistency | Effort label | Score % | Hints | On time | Hours | V2 screen cases |
|---|---|---|---|---|---|---|---|---|
| Alex Rivera | `advanced` | `consistent` | `independent_success` | 92 | 0.5 | true | 8 | High Five control |
| Sofia Chen | `grade_level` | `consistent` | `effortful_success` | 74 | 2.5 | true | 18 | Steady |
| Marcus Johnson | `reteach` | `erratic` | `struggling_trying` | 48 | 5.2 | false | 52 | reteach_needed, volatile |
| Emma Patel | `grade_level` | `variable` | `independent_struggle` | 78 | 0.8 | false | 36 | Volatile, medium alert |
| Jordan Kim | `grade_level` | `consistent` | `effortful_success` | 71 | 3.0 | true | 14 | Reteach cycle that improved (High Fives) |
| Lily Torres | `grade_level` | `consistent` | `effortful_success` | 76 | 2.0 | true | 10 | Steady |
| Darius Moore | `reteach` | `erratic` | `independent_struggle` | 38 | 0.2 | false | 72 | **Divergence case**: high HW, low quiz; critical alert |
| Nadia Okafor | *(no attempt)* | `consistent` | `independent_success` | 88 | 0.3 | false | 28 | **Not-yet-assessed** (null band cold-start) |

**How divergence is engineered for Darius:** V1 set `riskScore: 85, riskLevel: 'critical'`; `hw_quiz_divergence: Math.round(Math.random() * 15 + 10)`. In V2, engineer the `quiz_attempts.score_pct` low (≤40) and `homework_attempts.score_pct` high (≥60) so `computeHwQuizDivergence` (V2 `src/lib/signals/computeHwQuizDivergence.ts`) returns `divergence_score ≥ 25`.

**Nadia's null-band case:** V1 included her in `STUDENT_PROFILES` with `band: 'advanced'` but the V2 spec (§4.2) changes this: she gets **no `quiz_attempts` row**, so `mastery_band` is null. This is a deliberate V2 spec deviation from V1 to exercise the cold-start/not-yet-assessed UI path. Do NOT follow V1 exactly for Nadia.

**`reteach_needed` flag:** V1 set this on `assignments`. V2 `0004_assignments_homework.sql` has `reteach_needed boolean DEFAULT false` — set it `true` for Marcus.

---

## 7. Homework/Assignment Column Differences

V1 `homework_attempts` had a `score` column that was renamed to `grade` in a V1 migration (055: "HW outputs grades"). V1 `seedDemo.mjs` used `score` (the old name) while `seedTrialDemoData.ts` used `grade` (the new name — note the comment: "Migration 055: column score → grade").

**V2 `homework_attempts` schema** (0004): the column is `score_pct numeric` — neither `score` nor `grade`. Map V1's `hwScore` value to `score_pct` in V2.

V1 `seedDemo.mjs` also wrote a `response_text` column on `homework_attempts` with band-differentiated sample student prose. V2 `0004` has `responses jsonb` instead of a `response_text text` column. The band-differentiated prose from V1 can be adapted: store the prose inside `responses` as `{ "response_text": "..." }` or restructure as a JSONB object keyed by task step.

V1 `homework_attempts` also had `class_id` as a direct column. V2 `0004` does not have `class_id` on `homework_attempts` (it is derived via `assignment_id → assignments.class_id`). Do not INSERT `class_id` on `homework_attempts` in V2.

---

## 8. `logTrialEvent` — V2 Equivalent

V1 (`lib/trial/logTrialEvent.ts`): inserts into `trial_events` with `{ school_id, user_id, event_type, metadata }`.

V2 `trial_events` table (0007): same columns, same `event_type` enum (includes `'trial_signup'`). The V2 port is a direct copy of `logTrialEvent.ts` into `src/lib/trial/logTrialEvent.ts`.

---

## 9. `school_licenses` — New V2 Requirement (not in V1 `provisionTrial`)

V1 had two separate functions:
- `lib/trial/provisionTrial.ts` — created school + users (but NOT `school_licenses`)
- `lib/licensing/trial.ts:provisionTrial(schoolId)` — created the `school_licenses` row separately

V2 fuses them into one `provisionTrial` call. The V2 `school_licenses` INSERT (from 0007):
```ts
await admin.from('school_licenses').insert({
  school_id: schoolId,
  tier: 'professional',
  status: 'trialing',
  student_limit: 300,
  trial_starts_at: now.toISOString(),
  trial_ends_at: trialExpiresAt.toISOString(),
  trial_converted: false,
});
```
This row must be inserted in V2's `provisionTrial` immediately after the `schools` row (after step 1 in §3 above, before step 2). The `school_licenses` table has a UNIQUE constraint on `school_id`, so on re-provision/idempotent re-run, use upsert with `onConflict: 'school_id'`.

---

## 10. Public Trial Signup Route (V2 stub → V1 pattern)

V1 `app/api/public/trial/signup/route.ts` is a fully-built POST handler with:
- In-memory rate limiter (3 req/IP/hour, `Map<string, {count, resetAt}>`)
- Input sanitization (strip HTML, length caps)
- Email format + domain blocklist check (`@trial-*.core.com` reject)
- `users` table duplicate-email guard (409)
- Calls `provisionTrial`, then `sendTrialWelcomeEmail` (blocking), then `fireTrialWebhook` (non-blocking)
- Stores `hl_contact_id` on school if webhook returns one
- Returns 201 with `{ success, message, trial_expires_at }` (no credentials in response body)

V2 has a stub (`src/app/api/public/trial/signup/route.ts`, 10 lines, returns 501). The V1 route is directly portable with two changes:
1. The admin client call: V1 used `createAdminSupabaseClient()` (sync, no `await`) — same in V2 (the V2 function is also synchronous).
2. The import of `provisionTrial` will be `@/lib/trial/provisionTrial` (V2 path).
3. `sendTrialWelcomeEmail` and `fireTrialWebhook` are V1-specific integrations; they are not yet created in V2. The route should be built to call them but those helpers are not P4b deliverables unless explicitly scoped.

---

## 11. `seedDemo.mjs` Band-Differentiated Assignment Tasks

V1 `seedDemo.mjs` (lines 171–187) created band-specific task arrays (`TASKS_BY_BAND`) with pedagogically distinct tasks per band:

- `reteach`: recall + sentence starters + fill-in-the-blank (`identify`, `list`, `fill_in`)
- `grade_level`: 3-4 sentence explanation + compare + apply (`write` x3)
- `advanced`: analyze + critique + design/synthesize (`analyze`, `critique`, `create`)

This differentiation also applied to the `content.instructions` string and a `bandLabel` in the assignment title. V1 also seeded per-band `response_text` prose (long sample student responses in `RESPONSE_BY_BAND`).

**V2 adaptation:** port `TASKS_BY_BAND` directly into `scripts/seedDemo.mjs`. The `content` JSONB column on `assignments` accepts this shape verbatim. `RESPONSE_BY_BAND` prose goes into `homework_attempts.responses` as `{ response_text: "<prose>" }` — see §7 above.

---

## 12. Idempotency Patterns — V1 vs V2

| Entity | V1 pattern | V2 adaptation |
|---|---|---|
| `schools` demo | SELECT by `name`, skip insert if found; `seedDemo` only | SELECT by `name` + `demo_mode=true`, upsert or skip |
| Auth users | SELECT `users.email` → if found, reuse id; skip `createUser` | `auth.admin.getUserByEmail(email)` → reuse id; upsert `users` row |
| `classes` | SELECT by `name + teacher_id`, skip if found | Same pattern |
| `enrollments` | `upsert({ onConflict: 'student_id,class_id' })` | Same — V2 0002 has this UNIQUE constraint |
| `guardians` | `upsert({ onConflict: 'parent_id,student_id' })` | Same — V2 0001 has this UNIQUE constraint |
| `lessons` | SELECT by `title + teacher_id`, skip if found | Same |
| `quizzes` | SELECT by `lesson_id + status='published'`, skip if found | Same |
| `quiz_attempts` | SELECT by `quiz_id + student_id + is_complete=true`, skip if found | Same |
| `assignments` | SELECT by `student_id + class_id`, skip if found | Same |
| `student_model_snapshots` | N/A (V1 used `student_model` table) | `upsert({ onConflict: 'student_id,snapshot_date' })` |
| `skill_learning_state` | N/A | `upsert({ onConflict: 'student_id,skill_id' })` per spec §4.2 |

---

## 13. `guardians` Linking Pattern

V1 (`lib/trial/seedTrialDemoData.ts:147-156`):
```ts
// V1 linked parent to first student two ways:
await admin.from('users').update({ parent_id: parentId }).eq('id', alexId);
await admin.from('guardians').upsert({
  parent_id: parentId,
  student_id: alexId,
}, { onConflict: 'parent_id,student_id' });
```

V2 `users.parent_id` exists (0001). `guardians(parent_id, student_id)` with UNIQUE constraint exists (0001). Both writes are needed in V2 for the parent-read path to work (the Parent screen and the guardian-scoped RLS policies in 0011 read `guardians`, not `users.parent_id`).

---

## 14. Password Generation

V1 `provisionTrial.ts` (lines 13-27) used a `{Adjective}{Noun}#{4digits}` generator (e.g. `BlueStar#4821`) from fixed word lists. This is portable as-is; it produces memorable, strong-enough passwords for demo accounts. The generated password is shared across all 4 role accounts in the trial school (all use the same password), stored in `schools.trial_credentials` JSONB, and returned in `ProvisionTrialResult`.

---

## 15. Error Handling / Cleanup Contracts

V1 `provisionTrial.ts`:
- Auth-user creation failure → DELETE the schools row and throw.
- Additional demo account failures → `console.error` + `continue` (soft fail, not hard fail).
- `seedTrialDemoData` failures → `console.error` per step, but function does not throw; provisioning still returns a result.
- V1 wrapped each seeder step in individual try/catch blocks.

**V2 adaptation:** carry the same contract. The critical path (school + primary teacher) is hard-fail-with-cleanup. Demo accounts and seed data are soft-fail per step so a partial seed is better than no provisioning at all.
