# V1 Trial Automation Guide

**Source repo:** `C:/users/inteliflow/core`
**Grounding file:** `v1-03-automation-guide.md`

---

## Overview

V1 fully automates trial provisioning through a single public API endpoint. When a prospect submits the trial signup form, the system creates a complete isolated school environment — auth users, school record, license, demo class, 8 students with realistic data, and CRM registration — all in one atomic sequence. No manual ops step is required for a standard trial.

---

## Entry Point

**Route:** `POST /api/public/trial/signup`
**File:** `app/api/public/trial/signup/route.ts`

This is an unauthenticated public endpoint. It handles rate limiting (3 requests per IP per hour, in-memory), input validation, and orchestrates the full provisioning sequence.

**Required body fields:**
- `first_name`, `last_name`, `email`, `school_name`

**Optional body fields (defaulted if absent):**
- `role` → defaults to `"teacher"`
- `school_type` → defaults to `"K-12"`
- `trial_source` → defaults to `"landing_page"`

**On success:** returns HTTP 201 with `{ success: true, trial_expires_at }`. Credentials are emailed; the API response does NOT include passwords.

---

## Provisioning Sequence (`lib/trial/provisionTrial.ts`)

The `provisionTrial()` function runs in order. Each step either succeeds or throws (except demo seeding, which logs and continues):

### Step 1 — Generate trial password
A single memorable password (`Adj + Noun + 4-digit PIN`, e.g. `BlueWave#4821`) is generated and shared across ALL four demo accounts. This is intentional — the welcome email presents all four credentials so the teacher can log in as any role.

### Step 2 — Compute trial window
**Hardcoded:** `30 days` from `now()`. The constant `TRIAL_DURATION_DAYS = 30` lives in `lib/licensing/tiers.ts`. There is no configuration surface for this; changing the trial length requires a code change.

### Step 3 — Create school record
Inserts into `schools` with these hardcoded/defaulted values:

| Column | Value | Source |
|---|---|---|
| `is_trial` | `true` | hardcoded |
| `trial_started_at` | `now()` | computed |
| `trial_expires_at` | `now + 30 days` | hardcoded duration |
| `trial_status` | `'active'` | hardcoded |
| `trial_plan` | `'pro'` | hardcoded |
| `trial_source` | from input | caller-supplied |
| `demo_mode` | `false` | hardcoded |

### Step 4 — Create teacher auth user
Uses `supabase.auth.admin.createUser()` with `email_confirm: true` (skips confirmation email). On failure, rolls back by deleting the school row.

### Step 5 — Create teacher `users` profile row
Sets `role: 'teacher'`, `is_trial_user: true`, `trial_school_id: schoolId`.

### Step 6 — Create 3 additional demo accounts
Three fixed personas are auto-created with synthetic emails:
- `demo-student1@trial-{schoolIdShort}.core.com` — Alex Rivera (student)
- `demo-parent@trial-{schoolIdShort}.core.com` — Carlos Rivera (parent)
- `demo-admin@trial-{schoolIdShort}.core.com` — Principal Davis (school_admin)

`schoolIdShort` = first 8 chars of the school UUID. All three share the same generated password as the teacher.

### Step 7 — Store credentials in school row
All four sets of credentials (email + password) are stored in `schools.trial_credentials` as JSONB.

### Step 8 — Seed demo data (`lib/trial/seedTrialDemoData.ts`)
Creates a fully populated demo environment:
- **8 student accounts** with hardcoded names and personas (Alex Rivera through Darius Moore) — each with distinct mastery band, risk score, effort pattern, XP, streaks, and badges. All data is static/hardcoded — not generated.
- **1 class:** `AP English Literature — Period 3` (hardcoded name, grade, subject)
- **1 lesson:** `The Great Gatsby — Chapters 1-5` with hardcoded parsed content
- **1 quiz** with 3 MCQ + 2 open questions (hardcoded)
- **Quiz attempts** for all 8 students (submitted 3 days ago, hardcoded scores from profiles)
- **Assignments + homework attempts** per student (differentiated by mastery band)
- **Student model records** (`student_model` table) with pre-computed trends
- **Gamification records** (`student_gamification`)
- **Signal aggregates** (`signal_aggregates`) with risk scores
- **2 alerts** pre-seeded: Darius Moore (high/critical), Emma Patel (medium)

### Step 9 — Log trial signup event
Writes to `trial_events` table (event_type: `trial_signup`). Fire-and-forget, never throws.

---

## License Provisioning (`lib/licensing/trial.ts`)

Note: There are **two distinct provisioning paths** in V1 — the trial signup endpoint uses `lib/trial/provisionTrial.ts`, while `lib/licensing/trial.ts` contains a **separate** `provisionTrial()` function that creates a `school_licenses` row. The signup endpoint does NOT call `lib/licensing/trial.ts` directly.

The licensing-layer `provisionTrial()` (for `school_licenses`) hardcodes:
- `tier: 'professional'`
- `status: 'trialing'`
- `student_limit: 300`
- Trial duration: `TRIAL_DURATION_DAYS` (30) from `tiers.ts`

When Pro/Enterprise tier is granted, `ensureSparkProvisioning()` auto-creates a `platform_api_keys` row for Spark (idempotent).

**`convertTrial()`** upgrades an existing trial to a paid license (updates `school_licenses`, logs `trial_converted` event, calls `ensureSparkProvisioning` again).

**`expireTrials()`** is a bulk expiry function for cron use — finds `status='trialing'` rows past `trial_ends_at` and bulk-sets them to `status='suspended'`.

---

## Welcome Email (`lib/trial/sendWelcomeEmail.ts`)

Sent synchronously (blocks the response) via Resend. Contains:
- Teacher login credentials (highlighted)
- All 4 role credentials (student, parent, admin — same password)
- Login URL: `https://app.inteliflowai.com/login` (hardcoded)
- Trial end date
- Quick start guide (3 hardcoded steps)
- Calendly link: `https://calendly.com/inteliflow` (hardcoded)

An internal notification is also sent to `core@inteliflowai.com` on every trial signup.

**If Resend fails:** the signup is NOT rolled back. The provisioning still completes; the caller gets credentials in the DB and via the API response shape, but the email is lost.

---

## HighLevel CRM Webhook (`lib/trial/fireHLWebhook.ts`)

**Fired:** non-blocking (`.then()` after the response is already sent), on every successful trial signup.

**Env key:** `HL_WEBHOOK_URL` — if unset, logs a warning and skips silently. This key is **not present** in `.env.example` (it was omitted when the file was last updated).

**Payload sent to HL:**

```json
{
  "first_name": "...",
  "last_name": "...",
  "email": "...",
  "phone": "",
  "source": "core-trial",
  "form_type": "trial_signup",
  "product": "CORE",
  "school_name": "...",
  "school_type": "...",
  "role": "...",
  "trial_source": "...",
  "trial_expires_at": "ISO string",
  "school_id": "UUID",
  "submitted_at": "ISO string",
  "tags": ["core-trial", "core-lead", "{trial_source}", "{school_type_slug}"]
}
```

**Contact ID storage:** If HL returns a `contact_id` or `id` in the response, it is stored in `schools.hl_contact_id`. This is the only field written back from the webhook.

**Second HL integration (`app/api/attempts/highlevel/route.ts`):** A separate HL route exists for the learner challenge / booth form. This one uses `HL_API_KEY` + `HL_LOCATION_ID` (the v2 API — `https://services.leadconnectorhq.com/contacts/`) and is NOT related to trial signup. The trial webhook (`HL_WEBHOOK_URL`) is a simple HTTP POST to a HL automation workflow URL, not the v2 API.

---

## Trial Expiry Cron (`app/api/attempts/trial-expiry/route.ts`)

**Schedule:** `0 0 * * *` (daily at midnight UTC, defined in `vercel.json`)

Two phases per run:
1. **Expire:** Finds `schools` with `trial_expires_at < now AND trial_status = 'active'`, sets `trial_status = 'expired'`, logs `trial_expired` to `license_events`, sends expiry email to all `school_admin` users.
2. **Nudge:** Finds trials expiring within 5 days, checks `license_events` for `day_25_email_sent` (idempotency guard), sends "5 days left" email and logs the event.

Auth: `CRON_SECRET` or `INTERNAL_API_SECRET` as a `Bearer` token.

---

## What Is Hardcoded vs Configured

| Parameter | Value / Location | Configurable? |
|---|---|---|
| Trial duration | 30 days (`TRIAL_DURATION_DAYS` in `tiers.ts`) | Code change only |
| Trial tier | `'pro'` (school row) / `'professional'` (license row) | Code change only |
| Trial student_limit | 300 (`school_licenses`) | Code change only |
| Demo personas | 8 fixed names (Alex Rivera, Sofia Chen, etc.) | Code change only |
| Demo class name | `AP English Literature — Period 3` | Code change only |
| Demo lesson content | Great Gatsby Ch 1-5, hardcoded | Code change only |
| Login URL in email | `https://app.inteliflowai.com/login` | Code change only |
| Calendly URL | `https://calendly.com/inteliflow` | Code change only |
| Internal alert email | `core@inteliflowai.com` | Code change only |
| Resend from address | `CORE <noreply@inteliflowai.com>` | `RESEND_FROM_EMAIL` env (optional) |
| Email transport | `RESEND_API_KEY` env | Required env |
| HL webhook URL | `HL_WEBHOOK_URL` env | Optional env (skips if missing) |
| HL contacts API | `HL_API_KEY` + `HL_LOCATION_ID` env | Required for learner-challenge route |
| Rate limit (signup) | 3 per IP per hour, in-memory | Code change only |

---

## Schema Columns Added by Trial (Migration 035)

On `schools`:
- `is_trial` boolean
- `trial_started_at`, `trial_expires_at` timestamptz
- `trial_status` text (enum: inactive/active/expired/converted/cancelled)
- `trial_plan` text (defaults `'pro'`)
- `trial_source` text
- `hl_contact_id` text
- `trial_credentials` jsonb

On `users`:
- `is_trial_user` boolean
- `trial_school_id` uuid → schools

Tables created:
- `trial_events` (school_id, user_id, event_type, metadata, created_at)

---

## Supporting Scripts (non-runtime)

- `scripts/create-hl-workflows.ts` — Connects to HL API, creates tags, prints a manual workflow build guide (HL does not support programmatic workflow creation via API)
- `scripts/generate-hl-snapshot.ts` — Exports HL pipeline/workflow snapshot to `output/core-hl-snapshot.json`
- `scripts/get-hl-stages.ts` — Fetches HL pipeline stage IDs
- `scripts/seedDemo.mjs` — Seeds the Westview demo school (school ID from `CORE_DEMO_SCHOOL_ID` env)
- `scripts/reseedDemoHomework.mjs` — Re-seeds homework data for Westview demo

---

## Full List of Env Keys for Trial/Email/CRM

```
# Required for trial email delivery
RESEND_API_KEY=
RESEND_FROM_EMAIL=   # optional, defaults to CORE <noreply@inteliflowai.com>

# Required for HighLevel contact API (learner challenge form)
HL_API_KEY=
HL_LOCATION_ID=

# Optional — HL trial signup webhook (simple POST to automation URL)
HL_WEBHOOK_URL=      # NOT in .env.example — must be added manually

# Cron auth
CRON_SECRET=
INTERNAL_API_SECRET=

# Supabase (admin client needed for provisionTrial)
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Demo school
CORE_DEMO_SCHOOL_ID=  # Westview demo school UUID
```
