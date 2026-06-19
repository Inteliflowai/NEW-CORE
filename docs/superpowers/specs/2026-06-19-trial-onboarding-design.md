# CORE v2 — Self-Serve Trial Onboarding (+ Pilot Provisioning) — Design Spec

**Status:** Design — for product-owner review → `writing-plans`
**Date:** 2026-06-19
**Depends on:** Plan 4b Foundation (merged/branch `feat/p4b-foundation`) — reuses `provisionTrial`, `seedTrialDemoData`, `ensureAuthUser`, `logTrialEvent`, the demo cast, and `school_licenses`.
**Grounding:** `docs/superpowers/specs/trial-grounding/v1-0{1,2,3}-*.md` (verbatim V1 reference — the port source).

---

## 1. Goal & scope

Stand up the **automated self-serve trial** so a prospect can go from a public form to a working, fully-lit demo school in one step — and the **pilot** path (we provision real clients) alongside it. Both reuse the **one** `provisionTrial` engine already built and reviewed in 4b.

**Two paths, one engine:**

| Path | Who triggers | Entry | Seeded with | Primary human | Status |
|---|---|---|---|---|---|
| **Trial** | The prospect (self-serve) | Public signup form → `POST /api/public/trial/signup` | Demo cast (8 students, lit-up) | **school_admin** | NEW (this spec) |
| **Pilot** | Us (super admin) | `(super-admin)/provision` UI → `POST /api/admin/provision-trial` | Demo cast now; real roster on convert (A+C) | school_admin | BUILT (4b) |

**Decisions locked with the product owner (2026-06-19):**
- **One-shot immediate provision** (V1's proven flow), NOT confirm-first/double-opt-in. The emailed link is a *login* link, not a "click to create" step.
- **Pilots = A+C:** demo-seeded as a real client now; swap to their real roster when they convert (future `convertTrial`).
- **Resend** for email. **Upstash Redis** rate-limiting. **HighLevel CRM webhook wired fully.** **Full trial lifecycle** (expiry + nudge emails).
- **First-login onboarding** so a new admin doesn't land blind.

**Out of scope:** the real-roster import for pilot conversion (future), printable/downloadable reports (separate brainstorm), multilingual demo content (V2 is English now).

---

## 2. Global constraints (binding)

- **Reuse, don't re-port:** the trial signup route calls the **existing** `src/lib/trial/provisionTrial.ts` (school + Professional license + accounts + demo seed, fused — already closes V1's "license never created" gap). Do NOT re-implement provisioning.
- **Four-audience discipline still applies to email copy:** the welcome/nudge/expiry emails go to the **school_admin** (staff), so credentials + upgrade CTAs are in-scope. But ANY student/parent-facing email must follow the discipline (soft words, banded risk, no raw numbers) — not in this spec's scope, but the rule stands.
- **No secrets in logs.** Passwords appear only in the DB (`trial_credentials`) and the delivered email body — **never** in `console.*` or the HTTP response body (V1 returns no password in the 201). Error responses never leak internals.
- **Env-driven URLs:** every link (login, upgrade, Calendly) is built from `NEXT_PUBLIC_APP_URL` (+ constants), NOT hardcoded (V1 hardcoded `app.inteliflowai.com` — a rebrand/staging footgun we fix here).
- **Public endpoint hardening:** the signup route is unauthenticated — it MUST rate-limit (Upstash), sanitize/strip HTML, block the synthetic demo-domain, and dup-check before provisioning.
- **Auth chain unchanged** for the admin/cron routes: `getUser` → role/secret gate → guard → admin client. The cron is gated by `CRON_SECRET`/`INTERNAL_API_SECRET` bearer.
- **Schema truth (V2):** `schools.trial_status` enum = `inactive|active|expired|converted|cancelled`; `school_licenses.status` = `trialing|active|past_due|suspended|cancelled`. `trial_events` exists. `schools.welcome_completed` exists (drives onboarding). Verify all writes against `supabase/migrations/`.

---

## 3. The trial role model (a deliberate change from V1)

V1 made the **registrant the teacher** + a synthetic `Principal Davis` admin. The product owner's call for V2: **the registrant is the `school_admin`** (they own the demo school). So:

- **Registrant** → `school_admin` (real email, the shared generated password).
- The **demo cast** (already built in `demoCast.ts`) supplies the **teacher (Dana Whitfield)** who owns the demo class + the 8 students + a parent — all with synthetic `@trial-<shortId>.core.com` emails sharing the password.
- The admin can observe a real teacher's view because the 4b teacher screens allow `school_admin` to see same-school classes (`guardClassAccess`). The welcome email surfaces the **teacher** login too (so they can "be the teacher" for the demo) plus their own admin login.

**`provisionTrial` refinement (small):** it currently creates the primary account as `teacher` (from `teacher_email`). Add a `primaryRole: 'school_admin' | 'teacher'` (default `school_admin` for self-serve trial), and ensure the demo class's `teacher_id` points to the seeded demo teacher (Dana), not the registrant. The plan verifies this against the built `provisionTrial`/`seedTrialDemoData` and adjusts. *(Open Q1 — confirm registrant = school_admin.)*

---

## 4. End-to-end flow (one-shot)

```
[Public signup page]  name + email + school name
        │  POST /api/public/trial/signup
        ▼
[Signup route]
  1. Upstash rate-limit (per IP)         → 429 on breach
  2. parse JSON                          → 400 on bad body
  3. sanitize + validate fields          → 400 on invalid
  4. block synthetic demo domain         → 400
  5. dup-email check (users)             → 409 if exists
  6. provisionTrial({ primaryRole:'school_admin', ... })   ← BUILT engine
        → school + Professional license + admin + demo cast + trial_credentials + trial_event
  7. [BLOCKING] sendTrialWelcomeEmail(...)  ← credentials + login link (NEXT_PUBLIC_APP_URL) + internal alert
  8. [NON-BLOCKING] fireHighLevelWebhook(...) ← CRM lead; store contact_id on schools
  9. return 201 { success, message, trial_expires_at }   (NO password in body)
        │
        ▼
[Welcome email] → user clicks "Log in" → /login → first login
        ▼
[First-login onboarding]  if schools.welcome_completed === false → orientation → mark complete

[Daily cron GET /api/cron/trial-expiry]  (CRON_SECRET)
  ├─ expire: trial_expires_at < now & trial_status='active' → set schools.trial_status='expired'
  │         + school_licenses.status='suspended' (keep in sync) + license_events + "ended" email
  └─ nudge:  expiring within 5 days & not already nudged → "5 days left" email + idempotency row
```

---

## 5. Components

### 5.1 Email transport — `src/lib/email/resend.ts` (NEW; port of V1)
- `npm i resend` (V1 used `resend@^6.10.0`).
- `sendEmail({ to, subject, html, replyTo?, tags? }) → { success, id?, error? }` — client built from `RESEND_API_KEY`; if absent, returns `{success:false}` + logs a warning, **never throws** (so a missing key never crashes a signup).
- From: `RESEND_FROM_EMAIL` || `"CORE <noreply@inteliflowai.com>"`. Reply-to: `core@inteliflowai.com`.
- `brandedEmail(bodyHtml)` — CORE header/footer wrapper. **Use V2 tokens/brand**, and the logo/colors from the V2 design system (NOT V1's hardcoded indigo `#2b1460` — confirm the V2 brand color). *(Open Q5.)*
- `src/lib/email/mailer.ts` — thin throwing wrapper for callers that want hard-fail (optional; trial callers use `sendEmail` directly).

### 5.2 Welcome email — `src/lib/trial/sendWelcomeEmail.ts` (NEW; port)
- Called **blocking** from the signup route after `provisionTrial` returns. Subject: `Your CORE trial is ready — here are your login details`. Tag `trial-welcome`.
- Body: greeting; **admin login block** (registrant email + shared password) as the primary CTA "Log in →" to `${NEXT_PUBLIC_APP_URL}/login`; plus the **teacher / student / parent** demo logins (email+password each) so they can explore every role; trial-ends date; demo-class note ("pre-loaded with 8 students"); a Quick-Start; an onboarding-call CTA (`CALENDLY_URL` constant/env, not hardcoded). 
- Second send: **internal alert** to `core@inteliflowai.com`, subject `New CORE trial — <school> (<email>)`, tag `trial-internal-alert`.
- Failure: caught + logged; signup is **not** rolled back (credentials are in the DB).
- **Password-in-email:** acceptable for disposable shared demo credentials (V1 pattern). *(Open Q3 — or force a password reset on first admin login as hardening.)*

### 5.3 Public signup page — `src/app/(public)/trial/page.tsx` (NEW)
- A simple public (unauthenticated) form: first name, last name, email, school name (+ optional school_type, trial_source hidden default `landing_page`). Token classes only; deep-ink labels. Posts to the route; on 201 shows "Check your email for your login details"; surfaces 409 ("already have an account → log in") and 429 ("try again later") cleanly. Confirm the route-group/path for public pages. *(Open Q6.)*

### 5.4 Signup route — `src/app/api/public/trial/signup/route.ts` (implement the 501 stub)
- **Rate-limit** (§5.5) → 429. **Parse** JSON → 400. **Validate**: `first_name`/`last_name` (≤100), `email` (lowercased, regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`), `school_name` (≤200); optional `role`/`school_type`/`trial_source`. **Sanitize** every string: `.trim().replace(/<[^>]*>/g,'')`. **Block** `email.includes('@trial-') && email.endsWith('.core.com')` → 400. **Dup-check** `users.email` → 409. Then `provisionTrial(...)` → `sendTrialWelcomeEmail(...)` (blocking) → `fireHighLevelWebhook(...)` (non-blocking) → `201 { success, message, trial_expires_at }` (no password). Response codes table = V1 §8 (200/201, 400, 409, 429, 500).

### 5.5 Rate limiting — `src/lib/rateLimit.ts` (NEW; Upstash)
- `npm i @upstash/ratelimit @upstash/redis`. Build from `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (both already in `.env.example`). Sliding window **3 requests / IP / hour** (port V1's limit). Key = first `x-forwarded-for`, else `x-real-ip`, else `'unknown'`. If Upstash env is absent (e.g. local dev), **fail open with a warning** (don't block local signups) OR fall back to a tiny in-memory limiter — *(Open Q4: fail-open vs in-memory fallback in dev)*. Reusable by other public routes later.

### 5.6 HighLevel CRM webhook — `src/lib/trial/fireHighLevelWebhook.ts` (NEW; wire fully)
- **Non-blocking** (`.then().catch()`), fired after the response is queued. POST to `HIGHLEVEL_WEBHOOK_URL` (in `.env.example`); skip with a warning if unset. Payload = V1's verbatim (grounding §7): `first_name, last_name, email, phone:'', source:'core-trial', form_type:'trial_signup', product:'CORE', school_name, school_type, role, trial_source, trial_expires_at, school_id, submitted_at, tags:['core-trial','core-lead',trial_source,school_type-slug]`. If HL returns `contact_id`/`id`, store it on `schools.hl_contact_id`. **`HIGHLEVEL_WEBHOOK_SECRET`** (new in V2, not in V1): send it as a signing header (e.g. `X-Webhook-Secret`) or HMAC — *(Open Q2: confirm what HL expects)*. Errors logged only, never surfaced.

### 5.7 First-login onboarding — `src/app/(...)/_components/WelcomeOnboarding.tsx` + a mark-complete action (NEW)
- On first authenticated load of a trial school_admin, if `schools.welcome_completed === false`, show a **lightweight, skippable** orientation (not a forced multi-step gate): "This is your demo school with 8 sample students. Here's where to look — **Roster** (who needs you today), **Gradebook**, **Insights** — and here's how to make a lesson/quiz." A "Got it" / dismiss action → `PATCH` (or server action) sets `schools.welcome_completed = true`. Token classes, deep-ink, frictionless (one clear path). Shows for the admin's school; reads the flag server-side. *(Confirm placement — likely the admin landing/dashboard.)*

### 5.8 Trial lifecycle cron — `src/app/api/cron/trial-expiry/route.ts` (implement the 501 stub)
- **Schedule:** daily `0 0 * * *` via `vercel.json` (add it). **Auth:** `Authorization: Bearer ${CRON_SECRET}` (or `INTERNAL_API_SECRET`) → 401 otherwise.
- **Expire pass:** schools where `trial_expires_at < now AND trial_status='active'` → set `schools.trial_status='expired'` **and** `school_licenses.status='suspended'` (keep the two in sync — single user-facing source = `schools.trial_status`); log `license_events` (`trial_expired`); email all `school_admin` of that school: subject `Your CORE trial has ended`, CTA `${NEXT_PUBLIC_APP_URL}/trial-expired`.
- **Nudge pass:** trials expiring within 5 days, `trial_status='active'`, not already nudged (idempotency: a `license_events` `day_25_email_sent` row inserted **before** send) → email `Your CORE trial ends in 5 days`, CTA `${NEXT_PUBLIC_APP_URL}`.
- Review the sibling `src/app/api/cron/trial-check/route.ts` stub — fold into this or remove (avoid duplicate crons). *(Open Q7.)*

### 5.9 Config / env (`.env.example` additions)
Present already: `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `HIGHLEVEL_WEBHOOK_URL`, `HIGHLEVEL_WEBHOOK_SECRET`, `CRON_SECRET`. **Add:** `RESEND_FROM_EMAIL` (optional), `NEXT_PUBLIC_APP_URL` (base URL for all email links — **required**), `INTERNAL_API_SECRET` (optional alt cron auth). Trial constants (`TRIAL_DURATION_DAYS=30`, tier `professional`, `student_limit=300`) live in a `src/lib/trial/constants.ts` (not hardcoded across files); already partly in `provisionTrial`. **Never commit real values.**

### 5.10 `provisionTrial` refinement (§3) + return shape
- Add `primaryRole` (default `school_admin` for the trial route; the pilot route may pass `school_admin` too). Ensure the demo class `teacher_id` = the seeded demo teacher. Confirm the return includes `{ schoolId, trialExpiresAt, credentials, loginUrl }` with `loginUrl` built from `NEXT_PUBLIC_APP_URL` — refactor the (currently env-less) login URL accordingly.

---

## 6. Security & honesty notes
- The signup endpoint is the only unauthenticated write path → rate-limit + sanitize + domain-block + dup-check are load-bearing, not optional.
- Disposable shared demo credentials in an email are an accepted tradeoff for a demo trial (low blast radius; the school is throwaway and auto-expires). If we want more, force a password change on first admin login (Open Q3).
- The CRM webhook is non-blocking and fail-silent — a CRM outage never blocks or breaks a signup.
- Demo content is **English** (V2 `demoCast`, generic names/Math) — multilingual is future; do not hardcode V1's Gatsby/AP-English content.

---

## 7. Open questions — RESOLVED (2026-06-19) + a dependency discovered

1. Registrant role → **`school_admin`** ✓ (the demo teacher Dana owns the class; the admin observes a real teacher view).
2. `HIGHLEVEL_WEBHOOK_SECRET` → **optional**: sent as an `X-Webhook-Secret` header when the env var is set, no-op when absent (V1 had no secret). Revisit the exact contract when the HL workflow is configured. Never blocks signup.
3. Password → **force a reset; NO plaintext admin password is emailed.** The admin account is created with a random, unknowable password; the welcome email carries a Supabase **set-password link** (`admin.auth.admin.generateLink({ type: 'recovery' })`) → lands on `/auth/callback` (exists) → a new **`/set-password`** page calls `supabase.auth.updateUser({ password })`. The throwaway **demo-role logins** (teacher/student/parent) keep the shared password in the email for exploration.
4. Upstash in dev → **fail-open with a warning** when the Upstash env is absent (don't block local signups).
5. Email brand → **cobalt `#2563eb`** (V2 `--cobalt-600` = `--brand`), text "◆ CORE" mark (no logo PNG) — NOT V1's indigo `#2b1460`.
6. Public path → signup at **`src/app/(public)/trial/page.tsx`** (new public route group). **But see the dependency below.**
7. `trial-check` cron stub → **fold into / delete** in favor of the single `trial-expiry` cron.

> ### ⚠ DEPENDENCY DISCOVERED — V2 has NO auth-entry UI
> Verification (2026-06-19) found V2 has the server-side auth chain + `src/app/auth/callback/route.ts` (Supabase `exchangeCodeForSession`, the mechanism for magic/recovery links) but **no `/login` page, no set-password/reset page, no `/logout`, no `/auth/auth-code-error` page, no `/trial-expired` page, and no sign-in code anywhere** (grep for `signInWithPassword` / `resetPasswordForEmail` / `updateUser({password})` / login forms → zero hits).
>
> This blocks the trial flow — the welcome email's "log in" and "set password" links have nowhere to land — and more broadly it means **no one can log into ANY V2 surface yet** (the 4b teacher screens, pilots, the demo seed are all unreachable without a login). So a minimal **Auth-entry UI** is a hard prerequisite: `/login` (email+password), `/set-password` (consumes the recovery link → `updateUser`), `/logout`, `/auth/auth-code-error`, and `/trial-expired`. **Sequencing is a product/eng decision — see the handoff.** (If a separate auth-screens plan is already on your roadmap, point me to it and we slot behind it.)

---

## 8. Sequencing (build order)
1. **Email layer** (§5.1) — `resend` install + `resend.ts`/`brandedEmail`/`mailer.ts` + env. (Unblocks every email.)
2. **Rate-limit helper** (§5.5) — Upstash. (Unblocks the public route.)
3. **`provisionTrial` refinement** (§5.10/§3) — `primaryRole` + env-driven `loginUrl`.
4. **Welcome email** (§5.2) + **HL webhook** (§5.6).
5. **Public signup route** (§5.4) — wires 1-4 together; + the **signup page** (§5.3).
6. **First-login onboarding** (§5.7).
7. **Trial lifecycle cron** (§5.8) + `vercel.json` schedule.

Each step: TDD where pure (validation, rate-limit key, payload builder, email HTML builder), integration-verified where it hits Supabase/Resend/Upstash (documented live checks like the foundation).

---

**Next step:** product-owner review of this spec (esp. the 7 open questions) → `superpowers:writing-plans` → subagent-driven build. Reviews via the in-house adversarial Workflow (primary) + `/code-review`.
