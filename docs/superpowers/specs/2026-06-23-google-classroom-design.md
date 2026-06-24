# Google Classroom Integration — Design Spec (CORE V2)

> **Grounding:** `docs/superpowers/plans/grounding/2026-06-23-google-classroom/2026-06-23-google-classroom-current-code.md` (verbatim V1+V2 current-code facts; read it for every `file:line`).
> **Status:** design for sign-off. Cadence after sign-off: `writing-plans` → subagent-driven-development + adversarial review, **per segment**.
> **Reference floor:** V1 `C:/users/inteliflow/core` (the working integration to port). V2 `C:/users/inteliflow/NEW-CORE` (greenfield for GC — only placeholder columns exist).

---

## 1. Goal

Let a teacher connect their Google account once, then: **import their Google Classroom roster** into CORE, **publish CORE assignments** into Classroom as coursework, and **push grades back** into Classroom. Plus two extras Marvin pulled into scope: **student one-click sign-in** (silent SSO launch from a Classroom assignment into CORE) and **Google Drive doc import** (pull a Drive/Docs file in as a lesson).

This is largely a **port** of V1's zero-dependency raw-`fetch` implementation, re-homed onto V2's conventions (auth chain, admin client, migrations, the SPARK external-integration discipline), with one upgrade V1 lacks: **encryption-at-rest for OAuth tokens**.

## 2. Locked decisions (Marvin, 2026-06-23)

| # | Decision | Choice |
|---|---|---|
| D1 | First-slice scope | **Full epic**: connect + roster + publish + grade passback **+ student silent-SSO launch + Drive doc import** |
| D2 | Grade release | **Teacher controls release** — CORE PATCHes `assignedGrade`+`draftGrade` but does **NOT** call `studentSubmissions:return` (mirror V1's modern connector) |
| D3 | OAuth grain | **Per-teacher** — each teacher grants their own Google consent; CORE acts as the linked teacher for their classes. `schools.google_classroom_enabled` stays the school feature flag |
| D4 | Token at-rest | **Encrypt now** — AES-256-GCM via `node:crypto`, new key env var; overrides V1's plaintext |

**Defaults taken (from the grounding's recommendations, no further input needed — documented here so the spec is self-contained):**
- **Raw `fetch`** over `classroom.googleapis.com/v1`, **zero new deps** (mirror V1 + SPARK ethos). One **centralized token-manager** fixes V1's 5×-duplicated refresh.
- **Identity:** adapt V2's existing `external_identities` `(school_id, provider, external_id, core_student_id)` — GC is its first real consumer — adding `email` + `last_seen_at` columns + a resolve helper. `provider='google'`, `external_id=` Google `userId`.
- **Write-back generation:** port **only** V1's modern connector + publications path; **ignore** V1's legacy per-student routes and their drifted log tables.
- **Match key:** email at import (parity), but ALSO write the `external_identities` google-id row at import so launch resolves by id.
- **School gate:** `schools.google_classroom_enabled` + presence of a teacher connection. **No `sso_configs`** (V2 lacks it; don't port it).
- **Single teacher-of-record** per class for the pilot; co-teacher handling deferred.
- **One** paginated course-list route + **one** paginated roster route (V1 had duplicates).
- **`schools.state`** auto-populated from the school address/profile at connect/provisioning (admin-overridable), falling back to the existing inline teacher-pick when null.

## 3. Architecture

```
Teacher ── connect (OAuth, per-teacher) ──► google_connections (encrypted tokens, RLS-locked)
                                                   │
   token-manager: exchange / refresh / decrypt ◄───┘   (the ONLY reader of token plaintext)
                                                   │
   raw fetch over classroom.googleapis.com/v1 ◄────┘
        ├─ roster import ──► classes (by google_course_id) + students + enrollments + external_identities
        ├─ publish ───────► courseWork (link-material) + google_publications row
        ├─ grade passback ─► studentSubmissions PATCH (draft+assigned, NO :return)  [fire-and-forget after()]
        ├─ student launch ─► silent SSO (prompt=none) ─► resolve external_identities ─► CORE session
        └─ drive import ──► drive.readonly export ─► Content Studio lesson
```

- **Single Google Cloud project**, app-global client creds in Vercel env, **one registered redirect URI** shared by connect + launch callbacks.
- Every protected route obeys V2's auth chain: `createServerSupabaseClient()` → `auth.getUser()` → `STAFF_ROLES` gate → object-level IDOR guard (`guardClassAccess`/`guardStudentAccess`) → `createAdminSupabaseClient()` (the only way to read the RLS-locked token + identity rows). **RLS is not the IDOR backstop.**
- All Google HTTP lives behind one adapter module (`src/lib/google/classroom.ts`), the single seam that touches `classroom.googleapis.com` — mirrors V1's `google-classroom.ts`.

## 4. Data model (migrations 0022+)

New code reads/writes via the admin client; all new tables are **RLS-enabled, deny-by-default** (like `external_identities`/`platform_links`).

**`google_connections`** (NEW — per-teacher token vault; chosen over bolting columns onto `users` so secrets are isolated + RLS-locked):
| column | type | note |
|---|---|---|
| `user_id` | uuid PK → users(id) on delete cascade | one connection per teacher |
| `school_id` | uuid → schools(id) | for scoping/audit |
| `google_id` | text | Google account `sub`/userId |
| `email` | text | the connected Google email |
| `access_token_enc` | text | **AES-256-GCM ciphertext** (`iv.tag.ciphertext`, base64url) |
| `refresh_token_enc` | text | ciphertext; only overwritten when Google returns a new one |
| `token_expiry` | timestamptz | lazy refresh when `< now()` |
| `granted_scopes` | text[] | last-known scopes (also re-checked live at scope-check) |
| `connected_at` / `last_refresh_at` | timestamptz | audit |

**`external_identities`** (ADAPT existing 0008 table): add `email text` + `last_seen_at timestamptz`. Keep `(school_id, provider, external_id, core_student_id)` + `UNIQUE(school_id, provider, external_id)`. Add a **resolve helper** — a service-role TS function `resolveExternalIdentity({schoolId, provider, externalId, email})`: external_id-first, then **unambiguous** verified-email (exactly one match, else null), never auto-creates (auto-create is roster-import only). (TS service-role over a SECURITY DEFINER RPC — keeps logic in code, mirrors how V2 already gates the table to admin-client only.)

**`google_publications`** (NEW — mirror V1's `lms_publications`): `id, school_id, provider='google', course_external_id NOT NULL, external_assignment_id, resource_type CHECK IN ('homework','quiz','course_link'), resource_id, published_by, launch_url NOT NULL, grade_passback_enabled NOT NULL DEFAULT true, max_points numeric, status DEFAULT 'published', last_sync_error`, `UNIQUE(provider, resource_type, resource_id, course_external_id)`. RLS: teacher limited to `published_by = auth.uid()`.

**Existing placeholders we reuse / decide on:** `classes.google_course_id` (the course↔class anchor — keep), `schools.google_classroom_enabled` (school gate — keep), `schools.state` (populate this epic). `classes.google_grade_sync_enabled` / `google_feed_enabled` exist but the modern path gates per-publication — leave them unused (optionally repurpose `google_grade_sync_enabled` as a per-class master toggle layered above per-publication gating; **default: leave unused**). **Do not** extend `platform_links` to `'google'` — its single `api_key` column can't hold OAuth token material; the dedicated `google_connections` table is the home.

**Migration-per-segment:** 0022 = token vault + `external_identities` add-columns + `schools.state` population; later segments add their own (`google_publications` in the publish segment). Migrations are static-text-asserted in `supabase/migrations/__tests__/migrations.test.ts` — every new table/column gets a test there.

## 5. Secrets / env (added this epic)

| env | purpose | shape |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | OAuth client (already placeholders in `.env.example`) | from the Google Cloud project; **register the one redirect URI** |
| `GOOGLE_TOKEN_ENC_KEY` | AES-256-GCM key for token-at-rest | 32 bytes, base64; **NEW** |
| `GOOGLE_LAUNCH_STATE_SECRET` | HMAC for student silent-SSO launch state (V2 has no `INTERNAL_API_SECRET`) | random 32+ bytes; **NEW** |

`src/lib/google/config.ts` reads these at module top-level with the SPARK idiom. A `config.test.ts` assertion is added for the new keys.

## 6. OAuth + scopes

- **Connect (per-teacher):** `GET /api/teacher/google/connect` → authorize URL with `access_type=offline`, `prompt=consent`, the 7-scope set, a random-uuid CSRF state cookie. Callback **attaches tokens to the currently-logged-in teacher** (never creates/switches sessions).
- **Scope set (7):** `openid email profile`, `classroom.courses.readonly`, `classroom.rosters.readonly`, `classroom.profile.emails`, `classroom.coursework.students`, `classroom.courseworkmaterials`, `drive.readonly` (Drive import is in scope). The **reconnect-check list** (`GC_REQUIRED_SCOPES`) is the write+roster subset.
- **Scope-check / reconnect:** `GET /api/teacher/google/scope-check` → refresh-if-expired → `tokeninfo` → diff vs required → `{connected, needsReconnect, missing}`. Mid-session `403 insufficient scope` → a typed `GoogleScopeError` that surfaces a reconnect CTA. *(Pre-build sanity item: confirm `tokeninfo` + `classroom/v1` + `oauth2/v2/userinfo` are current — flagged unverified in grounding §5.)*
- **Token-manager** (`src/lib/google/tokens.ts`): `getValidAccessTokenForTeacher(teacherId)` and `...ForCourse(courseId→teacher)` — decrypt, refresh-on-expiry (single implementation), re-encrypt + persist. Refresh does not null an existing refresh token.

## 7. Build segments (each: plan → SDD → adversarial review → Playwright preview → merge)

**Seg 1 — Connect + Token Vault (the spine).** Migration 0022 (`google_connections` + `external_identities` add-cols + `schools.state` populate); `src/lib/google/{config,crypto,oauthUrls,tokens,classroom}.ts`; routes `connect` + `auth/google/callback` (connect branch) + `scope-check` + `disconnect`; a teacher "Connect Google Classroom" surface (status + connect/reconnect/disconnect). Gated by `schools.google_classroom_enabled`. **Everything else depends on this.**

**Seg 2 — Roster import.** Routes: `courses` (list, paginated), `roster` (paginated, students), `import-roster` (class upsert by `google_course_id`; student match-by-email + create + enroll; `external_identities` google-id row; pin an "Open CORE" course-link material, fail-soft). The `resolveExternalIdentity` helper + the email/last_seen_at columns land here if not in Seg 1's migration. Import wizard UI (`select course → preview → import → done` with Created/Linked/Skipped tiles; surface the no-email skip count).

**Seg 3 — Assignment publish + grade passback.** Migration: `google_publications` + assignment external-binding columns (mirror SPARK's status-enum pattern). `publish` route → courseWork with the CORE launch URL as a **link material** + a publications row (`grade_passback_enabled` default true). Passback orchestration: fire-and-forget `after()` hooks on **homework-submit / quiz-submit / teacher-override**, gated per-publication, 0–100 → `max_points`, **PATCH draft+assigned, NO `:return`** (D2), fail-soft with retry + `last_sync_error`. (Reuse the existing Next 16 `after()` post-grade hook sites the SPARK passback already rides.)

**Seg 4 — Student silent-SSO launch.** New `GOOGLE_LAUNCH_STATE_SECRET`. `GET /api/auth/google/launch?next=…` (HMAC-signed state + internal-path allow-list + nonce cookie) → silent authorize (`prompt=none`) → callback launch branch → `resolveExternalIdentity` → CORE session; `/launch/unmatched` page for the no-identity case (never auto-creates).

**Seg 5 — Drive doc import.** `drive.readonly` (already granted). A `parse-google` equivalent (Docs export / file media) that feeds the **existing Content Studio import** surface — extend the "From a URL" tab or add a "From Google" path rather than a parallel pipeline.

## 8. Security

- **Token encryption** — `src/lib/google/crypto.ts`: `encrypt(plaintext)` = `aes-256-gcm` with a random 12-byte IV → store `iv.tag.ciphertext` (base64url); `decrypt()` reverses + verifies the auth tag (tamper → throw). Key from `GOOGLE_TOKEN_ENC_KEY`. Tokens are **never** logged, never returned to the client, only decrypted inside the token-manager.
- **Token rows RLS deny-by-default**, admin-client only; teacher reaches only their own connection via the auth chain.
- **Launch state** HMAC-signed (`GOOGLE_LAUNCH_STATE_SECRET`), 10-min TTL, nonce cookie, internal-path allow-list — port V1's `launchState` shape.
- **Passback never throws into grading** (fail-soft); **publish authorizes class ownership** (`guardClassAccess`) before any Google call.
- **Carry-in:** the deferred **per-user voice rate-limiter** (`/api/attempts/{transcribe,tts}`) folds into this epic's hardening pass, since GC is the next AI-adjacent surface and we're touching shared infra.

## 9. Out of scope / deferred

Co-teacher multi-teacher-of-record; a no-email-student resolution queue (just surface the count); inbound Google Pub/Sub push (purely outbound CORE→GC for now); the legacy V1 per-student routes + their drifted tables; encrypting *other* existing secrets (this epic only encrypts Google tokens).

## 10. Open items to confirm at build time (not blockers)

- Register the **exact redirect URI** in the Google Cloud project + Vercel env (one URI, shared).
- **Sanity-check the live Google API** versions/endpoints before Seg 1 build (`tokeninfo` deprecation, `userinfo` version) — grounding flagged unverified.
- Decide `schools.state` value **source** precisely (school address field vs admin-set) when wiring Seg 1's populate step.

---

## Self-review vs grounding
- Every "net-new for V2" row in the grounding gap-map (§8) maps to a segment above. ✓
- The four locked decisions (D1–D4) are each reflected in the data model / segments / security. ✓
- The `external_identities` shape clash is resolved (adapt V2's table + add cols + resolve helper), not left open. ✓
- Token encryption (D4) has a concrete `node:crypto` design + key env, no new dependency. ✓
- Student launch (D1) has its secret (`GOOGLE_LAUNCH_STATE_SECRET`) since `INTERNAL_API_SECRET` is absent in V2. ✓
