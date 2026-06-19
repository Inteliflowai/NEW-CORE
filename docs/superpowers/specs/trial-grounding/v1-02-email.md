# V1 Email Layer — Trial Grounding

_Source repo: `C:/users/inteliflow/core`_
_Captured: 2026-06-19_

---

## 1. Transport: Resend client

**File:** `lib/email/resend.ts`

```ts
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'CORE <noreply@inteliflowai.com>';
```

- **Package:** `resend@^6.10.0` (V1 `package.json`).
- **Guard:** if `RESEND_API_KEY` is not set, the client is `null` and `sendEmail()` returns `{ success: false, error: 'Email service not configured' }` — it logs a warning and does NOT throw.
- **From-address:** hard-coded fallback `CORE <noreply@inteliflowai.com>`. Overridable via `RESEND_FROM_EMAIL` (env key exists in code but is NOT listed in `.env.example` — set only at runtime).
- **Reply-to:** always `core@inteliflowai.com` (hard-coded in `resend.ts`).
- **`replyTo`** and **`tags`** are forwarded to Resend's `emails.send()`.
- **Blocking vs fire-and-forget:** `sendEmail` is `async`; callers `await` it unless they explicitly detach (see §3 below for each call site).

**Exported helpers from `lib/email/resend.ts`:**

| Export | Purpose |
|---|---|
| `sendEmail(opts)` | Core send wrapper; returns `{ success, id?, error? }` |
| `brandedEmail(bodyHtml)` | Injects CORE header (indigo `#2b1460`, logo PNG at `https://app.inteliflowai.com/core-logo-white.png`) + white body + stone footer |

**Thin re-export in `lib/email/mailer.ts`:** wraps `sendEmail` and throws on failure (instead of returning `{ success: false }`). Used by older callers (homework-graded, weekly-report). Trial email callers import directly from `lib/email/resend.ts`.

---

## 2. Env keys involved (V1)

| Key | Where set | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `.env.local` (value `re_dGUBdRji_...`) | Resend API auth |
| `RESEND_FROM_EMAIL` | NOT in `.env.example`, in code fallback only | Override from-address |
| `NEXT_PUBLIC_APP_URL` | `.env.local` = `https://app.inteliflowai.com` | Base URL for email links |
| `CRON_SECRET` | Vercel project settings | Guards trial-expiry cron route |
| `INTERNAL_API_SECRET` | Vercel project settings | Alternative cron auth |

**Legacy SMTP keys** (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`) are present in `.env.local` but are dead code — they are never referenced from any file. All delivery went through Resend after migration.

---

## 3. Trial-related email functions

### 3a. Trial Welcome Email

**File:** `lib/trial/sendWelcomeEmail.ts`
**Function:** `sendTrialWelcomeEmail(input)`

**Trigger:** Called from `app/api/public/trial/signup/route.ts` immediately after `provisionTrial()` returns. The call is **`await`-ed (blocking)** — the API route waits for the email before returning to the caller. If the email fails, the error is caught and logged but provisioning is NOT rolled back (credentials are already in the DB and returned in the JSON response).

```ts
// From route.ts comment:
// Send welcome email (blocking — user needs the credentials)
try {
  await sendTrialWelcomeEmail({ ... });
} catch (emailErr) {
  console.error('[trial-signup] Failed to send welcome email:', emailErr);
  // Don't fail the signup — credentials are in the response and stored in DB
}
```

**Subject:** `Your CORE trial is ready — here are your login details`

**Body content:**
- CORE indigo header (`#2b1460`) with "Welcome to CORE" + "Your 30-day Pro trial is ready"
- Greeting: `Hi ${firstName},`
- Intro paragraph: school name, trial pitch
- **Teacher login block** (indigo `#eef2ff` / `#4338ca`):
  - Email: `${credentials.teacher.email}` (the real email the user signed up with)
  - Password: `${credentials.teacher.password}` (the generated shared password)
  - Trial-ends date (formatted `Month D, YYYY`)
  - CTA button: "Log in as Teacher →" linking to `${loginUrl}`
- **Three demo role blocks** (student / parent / admin), each showing email + password, with colored left-borders (cyan, amber, green)
- Demo class note: "AP English Literature — Period 3, pre-loaded with 8 students"
- Quick Start numbered list (3 steps)
- Footer: "Reply to this email or book a 20-minute onboarding call" linking to `https://calendly.com/inteliflow`

**Login URL construction:** Hard-coded in `lib/trial/provisionTrial.ts`:
```ts
const loginUrl = 'https://app.inteliflowai.com/login';
```
NOT derived from `NEXT_PUBLIC_APP_URL` or any env var.

**Credentials structure passed to the email:**
```ts
credentials: {
  teacher: { email: input.email.toLowerCase(), password },          // real signup email
  student: { email: `demo-student1@trial-${schoolIdShort}.core.com`, password },
  parent:  { email: `demo-parent@trial-${schoolIdShort}.core.com`,   password },
  admin:   { email: `demo-admin@trial-${schoolIdShort}.core.com`,    password },
}
```
All four roles share the same generated password (format: `AdjectiveNoun#NNNN`, e.g. `BlueOak#3712`).

**Internal notification** (second call in the same function):
- **To:** `core@inteliflowai.com`
- **Subject:** `New CORE trial — ${schoolName} (${email})`
- **Tag:** `{ name: 'type', value: 'trial-internal-alert' }`
- **Blocking:** yes (second `await sendEmail(...)` in the same function; the route catches the outer `sendTrialWelcomeEmail` call so if the internal alert fails the whole batch fails silently)

**Resend tags on welcome email:** `[{ name: 'type', value: 'trial-welcome' }]`

---

### 3b. Trial Expiry Email (day-0)

**File:** `app/api/attempts/trial-expiry/route.ts` (the cron route itself)
**Function:** inline `expiryEmailHtml()` template

**Trigger:** Vercel cron (`GET /api/attempts/trial-expiry`) guarded by `Authorization: Bearer ${CRON_SECRET}` or `Authorization: Bearer ${INTERNAL_API_SECRET}`. Runs daily. Finds schools where `trial_expires_at < now AND trial_status = 'active'`.

**Subject:** `Your CORE trial has ended`

**Body content (via `brandedEmail()` wrapper):**
- Headline: "Your CORE trial has ended"
- Body: "Your 30-day trial has ended. Your data is saved for 14 days. Upgrade to restore access."
- Sub-copy: "All your class data, student signals, and homework history are safe. Upgrade before the 14-day grace period ends to pick up right where you left off."
- CTA button: "Upgrade Now →" linking to `https://app.inteliflowai.com/trial-expired`

**Recipients:** all `users.email` where `role = 'school_admin'` AND `school_id = <expired school id>`. Sent as a batch array to `sendEmail({ to: adminEmails[] })`.

**Blocking:** yes (`await sendEmail(...)` inside a for-loop). If send fails, the loop logs and continues.

**Resend tags:** `[{ name: 'category', value: 'trial-expired' }]`

---

### 3c. Trial Nudge Email (day-25, "5 days left")

**File:** same cron route `app/api/attempts/trial-expiry/route.ts`
**Function:** inline `nudgeEmailHtml()` template

**Trigger:** Same daily cron as above. Second pass: finds schools where `trial_expires_at` is between `now` and `now + 5 days` AND `trial_status = 'active'` AND `license_events` does NOT already contain a `day_25_email_sent` row for this school (idempotency guard).

**Subject:** `Your CORE trial ends in 5 days`

**Body content (via `brandedEmail()` wrapper):**
- Headline: "Your CORE trial ends in 5 days"
- Body: "You have 5 days left on your trial. Upgrade now to keep your class data and signals."
- Sub-copy: "Your students' mastery profiles, homework history, and cognitive signals are waiting. Choose a plan and keep the momentum going."
- CTA button: "Upgrade Now →" linking to `https://app.inteliflowai.com` (root, not `/trial-expired`)

**Recipients:** same pattern — `school_admin` role users for the school.

**Idempotency:** a `license_events` row with `event_type = 'day_25_email_sent'` is inserted BEFORE the send to prevent double-send on reruns.

**Blocking:** yes (`await sendEmail(...)`).

**Resend tags:** `[{ name: 'category', value: 'trial-nudge' }]`

---

## 4. Other email functions (non-trial, for context)

| Function | File | Subject pattern | Trigger |
|---|---|---|---|
| `homeworkGradedEmail` | `lib/email/mailer.ts` | `${studentName}'s assignment has been graded — ${title}` | graded API route |
| `weeklyReportEmail` | `lib/email/mailer.ts` | `${studentName}'s weekly progress report — ${weekOf}` | weekly cron |
| `reteachPlanEmail` | `lib/email/mailer.ts` | `A short plan to support ${studentName} this week` | teacher reteach action |
| `virtualHugsDigestEmail` | `lib/email/mailer.ts` | `${n} notes about ${studentName} — week of ${weekOf}` | Friday cron |
| `welcomeStudentEmail` | `lib/email/templates.ts` | `Welcome to CORE, ${name}!` | teacher roster import |
| `welcomeParentEmail` | `lib/email/templates.ts` | `CORE Learning Dashboard — ${studentName}` | teacher roster import |
| `badgeUnlockEmail` | `lib/email/templates.ts` | `${studentName} earned a new badge!` | badge engine |
| `gradingCompleteEmail` | `lib/email/templates.ts` | `Grading complete: ${studentName} — ${title}` | AI grading route |
| `sendLicenseKeyEmail` | `lib/email/licenseKeyEmail.ts` | `Your ${brand} license key for ${schoolName}` | billing/admin flow |
| `learnerChallengeProfileEmail` | `lib/email/learnerChallengeEmail.ts` | `Your Learner Profile: ${name}` | booth quiz completion |

---

## 5. Full flow diagram (trial signup → emails)

```
POST /api/public/trial/signup
  │
  ├── validateBody()
  ├── check duplicate email in users table (409 if exists)
  ├── provisionTrial(admin, { ... })
  │     └── returns { credentials, trialExpiresAt, loginUrl }
  │         loginUrl = 'https://app.inteliflowai.com/login' (hard-coded)
  │
  ├── [BLOCKING] sendTrialWelcomeEmail({ firstName, email, schoolName, trialExpiresAt, loginUrl, credentials })
  │     ├── sendEmail({ to: email,                 subject: 'Your CORE trial is ready...', tags: [{trial-welcome}] })
  │     └── sendEmail({ to: 'core@inteliflowai.com', subject: 'New CORE trial — ...', tags: [{trial-internal-alert}] })
  │
  ├── [FIRE-AND-FORGET] fireTrialWebhook({ ... })  // HighLevel CRM, no email
  │
  └── return 201 { success: true, trial_expires_at }

Daily cron GET /api/attempts/trial-expiry
  ├── Expire overdue trials → sendEmail({ to: adminEmails[], subject: 'Your CORE trial has ended', tags: [{trial-expired}] })
  └── Nudge day-25 trials → sendEmail({ to: adminEmails[], subject: 'Your CORE trial ends in 5 days', tags: [{trial-nudge}] })
```

---

## 6. V2 status (what exists vs. what is missing)

**V2 has:**
- `RESEND_API_KEY` in `.env.example` (line 30) — key named correctly
- `resend` NOT in `package.json` — package not installed
- No `lib/email/` directory of any kind
- No `sendEmail`, `brandedEmail`, or any email-sending code in `src/`
- `src/app/api/public/trial/signup/route.ts` — **stub only** (returns 501)
- `src/app/api/cron/trial-expiry/route.ts` — **stub only** (returns 501)
- `src/app/api/cron/trial-check/route.ts` — **stub only** (returns 501)
- `src/lib/trial/provisionTrial.ts` — **fully implemented** but calls NO email function
- `src/app/api/admin/provision-trial/route.ts` — platform-admin provisioning path, NO email call

**V2 is missing the following env keys** (present in V1 but absent from V2 `.env.example`):
- `RESEND_FROM_EMAIL` (optional override for from-address)
- `NEXT_PUBLIC_APP_URL` (base URL used in email links — V1 hard-codes the production URL; V2 should parameterize this)
- `INTERNAL_API_SECRET` (alternative cron auth, used alongside `CRON_SECRET` in V1's trial-expiry route)
- `HL_WEBHOOK_URL` — referenced in V1 as `process.env.HL_WEBHOOK_URL`; V2 `.env.example` uses `HIGHLEVEL_WEBHOOK_URL` (renamed — must be consistent)
