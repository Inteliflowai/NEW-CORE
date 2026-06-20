# V1 grounding — SPARK provisioning / school-linking (for V2 SP-A super-admin provisioning)

Repo: `C:/users/inteliflow/core` (V1 CORE — proven prod that SPARK talks to today).
Method: READ-ONLY. All quotes verbatim with `file:line`. Reports what V1 DOES.

> **The file paths the task assumed do not exist in V1.** There is no
> `app/(dashboard)/admin/spark/page.tsx` and no admin "SPARK schools" linking UI.
> V1 has NO bespoke SPARK-provisioning screen. Provisioning is done by an
> **ops-secret-gated JSON API** (`POST /api/admin/platform-keys`) exercised from
> the generic `/platform/api-test` page (or curl). The "spark-schools" route IS
> real but is **read-only platform monitoring**, not a linker. Actual file map:
>
> | Task assumed | V1 reality |
> |---|---|
> | `app/(dashboard)/admin/spark/page.tsx` | ❌ none. Provisioning UI = `app/(dashboard)/platform/api-test/page.tsx` (generic ops test bench) |
> | `app/api/teacher/platform/spark-schools/route.ts` (GET list + POST link) | ✅ exists but **GET-only, read-only monitor**. No POST. Does NOT write links/keys/flags |
> | `app/api/teacher/admin/spark-activity/route.ts` | ✅ exists (school-scoped read-only health) |
> | `app/api/attempts/spark-status/route.ts` | ✅ exists (student poll) |
> | `app/(dashboard)/admin/page.tsx` | ✅ exists but is the **school-admin dashboard**, not a SPARK admin; only *consumes* `/api/teacher/admin/spark-activity` |
> | per-school SPARK key + base URL storage | `platform_api_keys` table (key) + a **single global** `SPARK_API_URL` env (base URL is NOT per-school) + `school_licenses.feature_overrides.spark_experiences` (the gate) |

---

## TL;DR — how V1 provisions a SPARK school (the answer to the NOTE)

V1 provisions **by writing CORE's OWN DB only** (a `platform_api_keys` row + the
`spark_experiences` license feature). It does **NOT** call any SPARK endpoint to
provision, and it does **NOT** write `core_spark_links` or `spark_schools` — those
two tables live **on the SPARK side**, and **SPARK** is responsible for creating
the link (SPARK resolves CORE's `school_id` → its own `spark_schools.id` via
`core_spark_links`). See the verbatim comment in `notifyAssignmentCreated.ts:106`:

> `/** CORE schools.id. SPARK resolves this to its own spark_schools.id via core_spark_links. */`

So **CORE's half of "provisioning" is two writes**:
1. **A per-school API key** — `POST /api/admin/platform-keys` with `{product:'spark', school_id}` → inserts a `platform_api_keys` row. (This is the SPARK→CORE inbound Bearer credential.)
2. **The license feature flag** — set `school_licenses.feature_overrides.spark_experiences = true` (or be on `professional`/`enterprise` tier, or `trialing`). There is **no dedicated endpoint** for this in the SPARK files; it is part of license provisioning (`checkFeature` reads `school_licenses`).

How SPARK's "`feature_flags.core_integration` must pre-exist" requirement is satisfied:
**V1 does not satisfy that from CORE.** The `core_integration` flag and the
`core_spark_links`/`spark_schools` rows are SPARK-side state. The `school_not_linked`
/ `core_integration_disabled` error codes come **back from SPARK** (see
`notifyAssignmentCreated.ts:247-248` and migration `056:14-16`). CORE just sends
`school_id`; if SPARK isn't linked, SPARK returns `success:false` with that code and
CORE marks `assignments.spark_sync_failed = true`. **Linking is a SPARK-side manual/ops step, out of band from CORE.**

**Auth direction matters (two different secrets):**
- **Provisioning** (mint per-school keys, sign test JWTs) is gated by `CORE_PROVISIONING_SECRET` via header `X-Provisioning-Secret` (`lib/platform/provisioningAuth.ts`). NOT a user session, NOT a SPARK key.
- **Runtime CORE↔SPARK traffic** uses a **single shared platform secret** `CORE_SPARK_API_SECRET` (env, not per-school) as a `Bearer` for both outbound (notify) and inbound (attempt-complete) — see below. The per-school `platform_api_keys` row is used for **read** endpoints (`/api/attempts/platform/*`) via `validatePlatformAuth`, NOT for the notify/complete webhooks.

---

## 1. The provisioning endpoint — `POST /api/admin/platform-keys`  (`app/api/admin/platform-keys/route.ts`)

Header doc (`:1-14`):
```
// POST — create. Body: { product, school_id, api_key?, label?, is_active? }
//   - api_key optional; server generates if missing
//   - 409 if (school_id, product) already has a row (unique constraint)
// GET  — list. Query: ?school_id=&product=  (Never returns the api_key column)
// Auth: X-Provisioning-Secret: $CORE_PROVISIONING_SECRET
//       X-Operator: <email-or-service-name> (optional, for audit)
```

Auth gate (`:31-35`): `const auth = validateProvisioningAuth(req.headers); if (!auth.valid) return 401`.

Valid products (`:21`): `const VALID_PRODUCTS = new Set(['lift', 'spark', 'pulse', 'custom']);`

Validation + school existence (`:49-69`): rejects unknown product (400), missing `school_id` (400), and verifies `schools` row exists (`Unknown school_id` 400).

Key generation (`:72-74`, `:156-161`):
```
const apiKey = (body.api_key && body.api_key.trim().length >= 24) ? body.api_key.trim() : generateKey(product);
// generateKey: const rand = randomBytes(36).toString('base64url'); return `core_${product}_${rand}`;
```

**Exactly what it writes** (`:76-86`):
```
const { data: inserted, error: insertErr } = await admin
  .from('platform_api_keys')
  .insert({ school_id: schoolId, product, api_key: apiKey, label, is_active: isActive })
  .select('id, school_id, product, label, is_active, created_at')
  .single();
```
- Unique `(school_id, product)` collision → **409** (`:90-94`).
- Audit log on success (`:100-114`): `audit_logs` insert `action:'platform_api_key_provisioned'`, metadata includes `operator, ip, school_id, product, label, api_key_prefix: apiKey.slice(0,8)`.
- **Returns the raw `api_key` ONCE** in the 201 response (`:116-125`). GET never returns it (`:141`, write-once).

It does **NOT** call SPARK, does **NOT** write `core_spark_links`/`spark_schools`, does **NOT** touch `school_licenses` / feature flags. Key minting and feature-flag enabling are **separate** acts.

---

## 2. The provisioning auth guard — `lib/platform/provisioningAuth.ts`

`validateProvisioningAuth(headers)` (`:29-57`):
- Reads `process.env.CORE_PROVISIONING_SECRET`; **fails if missing or `< 32` chars** (`:30-38`).
- Compares header `X-Provisioning-Secret` to the secret with **constant-time** `timingSafeEqual` (`:20-27`, `:40-48`).
- `X-Operator` header (≤256 chars) captured for audit (`:50`). Extracts client IP from `x-forwarded-for`/`x-real-ip` (`:59-64`).

> NOTE for V2: this is a **standalone ops secret**, deliberately separate from
> per-school Bearer keys: comment `:3-5` — *"a leaked school key cannot be used to
> provision new keys."* V2 SP-A super-admin = a real authenticated `platform_admin`
> session (V2's `guardPlatformAdmin`); V1 used a **shared env secret with no user
> identity** (operator is just a free-text header). **This is the biggest delta.**

---

## 3. The feature gate — `lib/licensing/checkFeature.ts` + `school_licenses`

`spark-activity` (`:88`) calls `checkFeature(schoolId, 'spark_experiences')`. `checkFeature` (`checkFeature.ts:104-135`) reads `school_licenses` (cols `tier, status, feature_overrides, feature_blocks`, 60s Redis/mem cache) and returns true when:
- not `suspended`/`cancelled` (`:114-116`), AND
- `feature_blocks[feature] !== true` (`:119-121`), AND
- `feature_overrides[feature] === true` (explicit grant, `:124-126`), OR `status==='trialing'` → all professional features (`:129-131`), OR `tierIncludes(tier, feature)` (`:134`).

The cross-school monitor reimplements the same logic inline (`spark-schools/route.ts:117-147`): `feature_blocks.spark_experiences` wins; else explicit `feature_overrides.spark_experiences`; else `tier ∈ {professional, enterprise}` OR `status==='trialing'`.

> So "this school is SPARK-enabled" in V1 = **( a `platform_api_keys` row with `product='spark'` ) AND ( `school_licenses` grants `spark_experiences` )**. The two are tracked independently and surfaced as a 4-state discriminated union (see §4).

---

## 4. Read-only monitoring — `spark-schools` (platform) + `spark-activity` (school)

### `GET /api/teacher/platform/spark-schools/route.ts` (platform_admin only, **GET only, no POST**)
- Auth (`:66-73`): `users.role === 'platform_admin'` else 403. (Session-based, via `createServerSupabaseClient().auth.getUser()`.)
- Reads in one wave (`:84-103`): all `schools`, all `platform_api_keys` where `product='spark'`, all `school_licenses`, and 7d `assignments` where `assignment_mode='spark_experiment'` (joins `classes(school_id)`).
- Emits per-school `provisioning` discriminated union: `fully_enabled` / `key_only` / `feature_only` / `not_provisioned` (`:189-212`) plus `last_assignment_created_at`, `last_spark_signal_at`, `sync_failed_24h`, `attempts_7d`.
- Purpose comment (`:14-17`): *"who's NOT using SPARK?"* — sort by `last_assignment_at` asc. **It writes nothing.**

### `GET /api/teacher/admin/spark-activity/route.ts` (school_admin / school_sysadmin / platform_admin)
- Auth (`:45-52`): profile role in `['school_admin','school_sysadmin','platform_admin']` else 403. `platform_admin` may pass `?school_id=`; others scoped to own `school_id` (`:54-66`).
- Provisioning resolved from `platform_api_keys` (`product='spark'`, `.maybeSingle()`, `:83-87`) **AND** `checkFeature(schoolId,'spark_experiences')` (`:88`) → 5-state union `fully_enabled|gated_off|key_only|feature_only|not_provisioned` (`:102-130`).
- Adds `outbound_24h` (created/sync_failed/sync_pending counts off `assignments`), `students_with_spark_7d`, `top_rubric_dim` (mean over `student_model.spark_dim_*`), `recent_failures`. **Read-only.** Inbound webhook count is intentionally `null` because `spark_signal_dedupe` carries no `school_id` (`:288-291`).

### `app/(dashboard)/admin/page.tsx` (school-admin dashboard)
- Only *consumes* spark-activity (`:218-221`): `fetch('/api/teacher/admin/spark-activity')...setSparkActivity`. Holds the same 5-state union type (`:121-134`). It is NOT a provisioning surface and exposes **no** enable/link action.

---

## 5. Where the per-school SPARK key + base URL live

- **Key:** `platform_api_keys` table — columns used: `id, school_id, product, api_key, label, is_active, created_at, last_used_at`. Unique on `(school_id, product)`. One SPARK key per school.
- **Base URL:** **NOT per-school.** A single global env `SPARK_API_URL` (default `https://spark.inteliflowai.com`) is read everywhere:
  - `spark-status/route.ts:9` `const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';`
  - `spark-launch/route.ts:15` (same), `notifyAssignmentCreated.ts:31-33` (`getSparkApiUrl()` same).
- **Runtime shared secret:** `CORE_SPARK_API_SECRET` (env, NOT per-school) — outbound notify Bearer (`notifyAssignmentCreated.ts:35-37, 153, 202`) and inbound attempt-complete Bearer/JWT (`spark-attempt-complete/route.ts:15, 58-72`).
- **Inbound read auth uses the per-school key:** `lib/platform/auth.ts:27-44` — `validatePlatformAuth` looks up the `Bearer` token in `platform_api_keys` (`is_active=true`), returns `{product, school_id}`, **updates `last_used_at` fire-and-forget** (`:41`), and `isTenantMismatch` (`:77-82`) enforces a school-scoped key only acts on its own school's students.

`.env.example` cross-product secrets (`:24-32`):
```
CORE_SPARK_API_SECRET=      # CORE → SPARK auth + handoff
CORE_HANDOFF_SECRET=        # CORE-side handoff token signing
CORE_PROVISIONING_SECRET=   # Provisioning gate for /api/admin/platform-keys
```

---

## 6. The ops UI that drives provisioning — `app/(dashboard)/platform/api-test/page.tsx`

Generic client test bench (`'use client'`). Relevant for provisioning:
- Inputs `provisioningSecret` (→ `X-Provisioning-Secret`) and `targetSchoolId` (`:26-27`, `:580-589`).
- **`platform-keys-provision-spark`** test (`:498-512`): `POST /api/admin/platform-keys` body `{product:'spark', school_id: targetSchoolId, label:'Provisioned via /platform/api-test'}`, headers `X-Provisioning-Secret`, `X-Operator:'api-test'`.
- **`platform-keys-list`** (`:488-497`): `GET /api/admin/platform-keys?school_id=X&product=spark`.
- Also mints test SPARK JWTs via `POST /api/admin/sign-spark-test-jwt` (same provisioning secret) and posts them to `spark-attempt-complete` to exercise the webhook (`:387-482`).

There is **no other** SPARK admin/linking screen in V1.

---

## 7. Supporting status/activity endpoints (verbatim shapes)

### `GET /api/attempts/spark-status/route.ts` (student poll)
- Session auth (`:14-16`), verifies `assignments.student_id === user.id` (`:31`).
- If `content.spark_completed_at` set → returns cached `{status:'completed', score, effort_label, completed_at, rubric_dimensions, ai_layer, content_quality}` (`:44-55`).
- Else, if `SPARK_API_KEY (=process.env.SPARK_SCHOOL_API_KEY)` + URL set, POSTs to `${SPARK_API_URL}/api/integration/core` with `Bearer ${SPARK_API_KEY}` body `{action:'get_attempt_result', core_homework_id: assignmentId}` (`:58-72`); on completed, writes `assignments.status='completed'` + content (`:74-92`).
  > NOTE: this uses a **third** env name `SPARK_SCHOOL_API_KEY` (`:10`) — distinct from `CORE_SPARK_API_SECRET`. Not in `.env.example`; likely legacy/unused now (the live path is the webhook receiver, not this poll). Flag for V2.

### Inbound webhook receiver — `app/api/attempts/spark-attempt-complete/route.ts`
- Auth (`:52-79`): `Bearer` is EITHER an HS256 JWT signed with `CORE_SPARK_API_SECRET` (`validateSparkJWT`, `:29-50`) OR the **plain shared secret** itself (`timingSafeStringCompare(token, SPARK_SECRET)`, `:70-72`) — SPARK's current `notifyCoreAttemptComplete` sends `Bearer <CORE_SPARK_API_SECRET>` directly. Also accepts `x-internal-secret == INTERNAL_API_SECRET` (`:74`).
- Idempotency via `spark_signal_dedupe` (PK `idempotency_key`, migration 059): insert; `23505` → `{ok:true, deduped:true}`; other error → fail open (`:89-110`).

### Outbound notify — `lib/spark/notifyAssignmentCreated.ts`
- POSTs `${SPARK_API_URL}/api/integration/webhooks/core` (`:179`), `Authorization: Bearer ${CORE_SPARK_API_SECRET}` (`:153, 202`), `X-Idempotency-Key: ${core_homework_id}_${student_id}` (`:156, 178, 203`), 35s timeout (`:148`).
- Body event `spark_assignment_created` carries `school_id` (CORE schools.id) — comment `:106` confirms SPARK maps it to `spark_schools.id` via `core_spark_links`.
- Fail-soft, never throws (`:159`). On SPARK `success:false` returns SPARK's error code (`:250-273`): documented codes (migration `056:14-16`): `school_not_linked, core_integration_disabled, experiment_not_found, teacher_resolution_failed, session_creation_failed, transport_exhausted, other`.

### Launch handoff — `app/api/attempts/spark-launch/route.ts`
- POST returns `{launch_url}`; GET 302-redirects (`:1-9, 122-164`). JWT signed with `CORE_SPARK_API_SECRET` (`jsonwebtoken`, `:88-96`), 15m expiry, claims `{core_user_id, core_school_id, spark_attempt_id, email, full_name, grade, return_url}`. Target: `${SPARK_API_URL}/api/integration/auth?token=...&redirect=/student/experiment/{sparkAttemptId}` (`:99-110`). Gate (`:43-46`): requires `assignments.spark_attempt_id || spark_experiment_id`.

### Migration `supabase/migrations/056_spark_sync_state.sql`
Adds to `assignments`: `spark_sync_failed boolean DEFAULT false`, `spark_sync_error text`, `spark_sync_attempted_at timestamptz` (`:39-42`); partial index where `spark_experiment_id IS NOT NULL` (`:48-50`). `spark_attempt_id` predates this (migration 038, `:29`).

---

## 8. NOTE for the V2 designer (deltas vs what V2 built/assumed)

1. **No SPARK admin/linking UI exists in V1.** V2 SP-A is genuinely greenfield. The only precedent is the generic `/platform/api-test` bench + curl-against `POST /api/admin/platform-keys`.
2. **Provisioning auth in V1 is a shared env secret (`CORE_PROVISIONING_SECRET`) with NO user identity** (free-text `X-Operator`). V2 already standardized on `guardPlatformAdmin` (a real `platform_admin` session). V2 SP-A should be a session-gated endpoint, NOT an env-secret header — this is an intentional improvement, not a regression.
3. **CORE's provisioning is two independent writes:** (a) a `platform_api_keys` row (`product='spark'`, unique per `(school_id,product)`, raw key shown once) and (b) the `school_licenses` `spark_experiences` feature grant. V2 must decide whether SP-A does BOTH atomically (V1 did them separately).
4. **`core_spark_links` and `spark_schools` are SPARK-side tables — CORE never writes them.** Linking + `core_integration` flag are SPARK's responsibility (returned as `school_not_linked`/`core_integration_disabled` errors). **CORE provisioning is endpoint-direct to its OWN DB; the SPARK side is a separate manual/ops step.** → SP-A's "link a school" cannot be completed by CORE alone unless V2 also adds a CORE→SPARK provisioning call (which V1 does NOT have).
5. **Base URL is a single global env (`SPARK_API_URL`), not per-school.** If V2 assumed a per-school base URL / `platform_links` row, that diverges — V1 has one SPARK origin for all schools.
6. **Runtime auth is the global `CORE_SPARK_API_SECRET` (shared), not the per-school `platform_api_keys` key,** for the notify+complete webhooks. The per-school key is only used by the inbound *read* endpoints (`/api/attempts/platform/*`) via `validatePlatformAuth` (which updates `last_used_at`). V2 should not conflate the two.
7. **Stray env name `SPARK_SCHOOL_API_KEY`** appears only in `spark-status` (`:10`) and is not in `.env.example` — likely dead; verify before porting the poll path.
