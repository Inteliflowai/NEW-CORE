# V1 Trial Signup Flow — Grounding Reference

**Source files read (verbatim):**
- `app/api/public/trial/signup/route.ts`
- `lib/trial/provisionTrial.ts`
- `lib/trial/sendWelcomeEmail.ts`
- `lib/trial/fireHLWebhook.ts`
- `lib/trial/seedTrialDemoData.ts`
- `lib/trial/logTrialEvent.ts`
- `lib/trial/trialExpiry.ts`
- `lib/email/resend.ts`

---

## 1. Flow Shape: IMMEDIATE PROVISION (no double opt-in)

**There is no confirmation email, no pending-registration table, no token/nonce, no separate confirm/verify/activate endpoint.**

The single `POST /api/public/trial/signup` call:
1. Rate-limits the request
2. Validates and sanitizes the body
3. Checks for duplicate email in `users`
4. Calls `provisionTrial()` — which creates the school, all auth users, seeds full demo data, and stores credentials — synchronously before returning
5. Calls `sendTrialWelcomeEmail()` — blocking (awaited) — which sends the welcome email with live credentials to the signee and an internal alert to `core@inteliflowai.com`
6. Calls `fireTrialWebhook()` — non-blocking (`.then().catch()`) — which fires the HighLevel CRM webhook; if HL returns a `contact_id`, it is stored on `schools.hl_contact_id`
7. Returns `201 { success: true, message: '...', trial_expires_at }`

The user receives working login credentials in the welcome email immediately. The school is fully provisioned (8 demo students, class, lesson, quiz, attempts, gradebook signals, alerts) before the HTTP response is sent.

---

## 2. Endpoint

```
POST /api/public/trial/signup
```
No authentication required. Public route.

---

## 3. Rate Limiting

- **Implementation:** In-process `Map<string, { count: number; resetAt: number }>` (not Redis, not edge)
- **Key:** First value of `x-forwarded-for` header, then `x-real-ip`, then `"unknown"`
- **Limit:** 3 requests per IP per 1-hour window
- **Response on breach:** `429 { error: 'Too many trial requests. Please try again later.' }`
- **Cleanup:** Map is pruned on each request when size reaches 1000 entries
- **Caveat:** Resets on every cold start / serverless instance spin; not shared across instances

---

## 4. Input Validation

### Required body fields
| Field        | Type   | Constraint                          |
|---|---|---|
| `first_name` | string | required, max 100 chars             |
| `last_name`  | string | required, max 100 chars             |
| `email`      | string | required, lowercased, basic regex   |
| `school_name`| string | required, max 200 chars             |

### Optional body fields (defaulted if absent)
| Field          | Default         |
|---|---|
| `role`         | `"teacher"`     |
| `school_type`  | `"K-12"`        |
| `trial_source` | `"landing_page"`|

### Sanitization
All string fields are run through:
```ts
value.trim().replace(/<[^>]*>/g, '')
```
(strips HTML tags, trims whitespace)

### Email format
```ts
/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
```

### Blocked email domain pattern
```ts
email.includes('@trial-') && email.endsWith('.core.com')
```
This blocks the auto-generated demo-account emails (`*@trial-<schoolIdShort>.core.com`) from being reused for signups.

### Duplicate email
```ts
admin.from('users').select('id').eq('email', email).maybeSingle()
```
Returns `409 { error: 'An account with this email already exists. Please log in instead.' }` if found.

---

## 5. provisionTrial() — Step-by-step

### Password generation
```ts
`${adj}${noun}#${digits}`
// e.g. "BlueStar#4821"
// adj from 20-word list, noun from 20-word list, digits 1000-9999
```
One shared password is used for ALL role accounts in the trial school.

### Step 1 — Create school row (`schools` table)
```ts
{
  name: input.schoolName,
  is_trial: true,
  trial_started_at: now.toISOString(),
  trial_expires_at: trialExpiresAtStr,   // now + 30 days
  trial_status: 'active',
  trial_plan: 'pro',
  trial_source: input.trialSource,
  demo_mode: false,
}
```
On failure: throws immediately.

### Step 2 — Create teacher Supabase Auth user
```ts
admin.auth.admin.createUser({
  email: input.email.toLowerCase(),
  password,
  email_confirm: true,     // bypasses Supabase email verification
  user_metadata: { full_name: `${firstName} ${lastName}` },
})
```
On failure: deletes the school row, then throws.

### Step 3 — Create `users` profile row
```ts
{
  id: authUser.user.id,
  full_name,
  email,
  role: 'teacher',
  school_id: schoolId,
  is_trial_user: true,
  trial_school_id: schoolId,
}
```

### Step 4 — Create 3 demo role accounts (errors are logged, not thrown)
| emailPrefix      | role           | fullName          |
|---|---|---|
| `demo-student1`  | `student`      | Alex Rivera       |
| `demo-parent`    | `parent`       | Carlos Rivera     |
| `demo-admin`     | `school_admin` | Principal Davis   |

Email pattern: `<prefix>@trial-<schoolId[0..7]>.core.com`

Same password as teacher. `email_confirm: true`.

### Step 5 — Build credentials object
All four roles share the same generated password.

### Step 6 — Store credentials in `schools.trial_credentials` (JSONB)
```ts
{
  teacher: { email, password },
  student:  { email, password },
  parent:   { email, password },
  admin:    { email, password },
}
```

### Step 7 — `seedTrialDemoData()` — Full demo data seeded synchronously
Creates:
- 7 additional student auth users (`demo-student2` through `demo-student8`) + `users` rows
- 1 class: `"AP English Literature — Period 3"` (grade: `9th Grade`, subject: `English`)
- Enrollments for all 8 students
- Parent link: Alex Rivera ↔ Carlos Rivera (`guardians` table + `users.parent_id`)
- 1 lesson: `"The Great Gatsby — Chapters 1-5"` (status: `published`, includes `parsed_content` JSONB)
- 1 quiz: `"Gatsby Ch 1-5 Quiz"` with 5 questions (3 MCQ + 2 open)
- 8 quiz attempts (one per student, `submitted_at: now - 3 days`, `is_complete: true`)
- 8 assignments + `homework_attempts` (status: `graded`, `submitted_at: now - 2 days`, `graded_at: now - 1.5 days`)
- 8 `student_model` rows (upsert on `student_id`)
- 8 `student_gamification` rows (upsert on `student_id`)
- 8 `signal_aggregates` rows (upsert on `student_id`)
- 2 alerts: Darius Moore (severity: `high`, trigger: `mastery_regression`) + Emma Patel (severity: `medium`, trigger: `homework_low_score`)

### Step 8 — Log `trial_signup` event to `trial_events` table
```ts
{
  school_id, user_id,
  event_type: 'trial_signup',
  metadata: { email, school_name, school_type, trial_source, trial_expires_at }
}
```
Fire-and-forget; errors are console-logged, not thrown.

### Return value
```ts
{
  schoolId, schoolIdShort,
  userId, password,
  trialExpiresAt,             // ISO string, now + 30 days
  loginUrl: 'https://app.inteliflowai.com/login',
  credentials: {
    teacher: { email, password, role: 'teacher', fullName },
    student:  { email, password, role: 'student', fullName: 'Alex Rivera' },
    parent:   { email, password, role: 'parent', fullName: 'Carlos Rivera' },
    admin:    { email, password, role: 'school_admin', fullName: 'Principal Davis' },
  }
}
```

---

## 6. sendTrialWelcomeEmail()

- **Transport:** Resend (`lib/email/resend.ts`) — requires `RESEND_API_KEY` env var
- **From:** `process.env.RESEND_FROM_EMAIL` or `"CORE <noreply@inteliflowai.com>"`
- **Reply-to:** `core@inteliflowai.com`

### Two emails sent (both awaited):
1. **To signee** (`email`): Subject `"Your CORE trial is ready — here are your login details"`, tag `trial-welcome`
   - Contains all four role credentials (email + password for each)
   - Trial expiry date
   - Login URL: `https://app.inteliflowai.com/login`
   - Demo class note (AP English Literature, 8 students pre-loaded)
   - Calendly link: `https://calendly.com/inteliflow`
2. **Internal alert** (`core@inteliflowai.com`): Subject `"New CORE trial — <schoolName> (<email>)"`, tag `trial-internal-alert`

### Email failure handling
The `try/catch` in the route wraps both sends. If either throws, the error is logged but **the signup is not rolled back** — credentials are already in the DB and in the `201` response.

---

## 7. fireTrialWebhook() — HighLevel CRM

- **Non-blocking:** called with `.then().catch()` after the response has already been queued
- **Env var:** `HL_WEBHOOK_URL` — silently skipped if absent
- **Payload fields:**
  ```
  first_name, last_name, email, phone: '',
  source: 'core-trial', form_type: 'trial_signup', product: 'CORE',
  school_name, school_type, role (adminRole), trial_source,
  trial_expires_at, school_id, submitted_at,
  tags: ['core-trial', 'core-lead', trialSource, schoolType-slug]
  ```
- **Return value:** `contact_id` or `id` from HL response JSON, or `null`
- **Side effect:** If a `contactId` is returned, it is stored to `schools.hl_contact_id`
- **Errors:** logged to console only; never surface to caller

---

## 8. HTTP Response Codes

| Condition                        | Status | Body                                                      |
|---|---|---|
| Success                          | 201    | `{ success: true, message: '...', trial_expires_at }`    |
| Rate limited                     | 429    | `{ error: 'Too many trial requests...' }`                 |
| Invalid JSON body                | 400    | `{ error: 'Invalid JSON body' }`                          |
| Validation failure               | 400    | `{ error: '<field> is required' / 'Invalid email...' }`   |
| Duplicate email                  | 409    | `{ error: 'An account with this email already exists...'}`|
| Unhandled error                  | 500    | `{ error: '<message>' }`                                  |

---

## 9. Token / Nonce / Confirmation URL

**None.** V1 uses no confirmation token, no pending-registration table, no double opt-in step. The flow is single-step: POST → provision → email credentials → 201.

---

## 10. Key Environment Variables

| Variable            | Used by              | Effect if absent                          |
|---|---|---|
| `RESEND_API_KEY`    | `lib/email/resend.ts`| Emails silently skipped (logged warning)  |
| `RESEND_FROM_EMAIL` | `lib/email/resend.ts`| Defaults to `CORE <noreply@inteliflowai.com>` |
| `HL_WEBHOOK_URL`    | `fireHLWebhook.ts`   | HL webhook silently skipped               |

Supabase admin client (`createAdminSupabaseClient`) requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (standard Supabase admin pattern).

---

## 11. Database Tables Written

| Table                  | Operation | Notes                                           |
|---|---|---|
| `schools`              | INSERT then UPDATE | Created first; `trial_credentials` added in step 6 |
| `users`                | INSERT x4+         | Teacher + 3 demo roles; additional students in seed |
| `classes`              | INSERT             | 1 demo class per trial                          |
| `enrollments`          | INSERT x8          | All demo students enrolled                      |
| `guardians`            | UPSERT             | Alex Rivera ↔ Carlos Rivera                    |
| `lessons`              | INSERT             | 1 demo lesson (Gatsby Ch 1-5)                  |
| `quizzes`              | INSERT             | 1 quiz                                          |
| `quiz_questions`       | INSERT x5          | 3 MCQ + 2 open                                  |
| `quiz_attempts`        | INSERT x8          | One per student                                 |
| `assignments`          | INSERT x8          | One per student                                 |
| `homework_attempts`    | INSERT x8          | One per student                                 |
| `student_model`        | UPSERT x8          | On `student_id`                                 |
| `student_gamification` | UPSERT x8          | On `student_id`                                 |
| `signal_aggregates`    | UPSERT x8          | On `student_id`                                 |
| `alerts`               | INSERT x2          | Darius Moore + Emma Patel                       |
| `trial_events`         | INSERT             | `trial_signup` event                            |

---

## 12. Supabase Auth

All users created via `admin.auth.admin.createUser({ email_confirm: true })` — Supabase email confirmation is bypassed server-side. No Supabase magic links or OTP are used.

---

## 13. V2 Current State (NEW-CORE)

`src/app/api/public/trial/signup/route.ts` is a stub:
```ts
// P1 stub — body is a later-plan deliverable.
export async function POST() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
```
Returns `501` for both `POST` and `GET`. No provisioning, no email, no webhook.
