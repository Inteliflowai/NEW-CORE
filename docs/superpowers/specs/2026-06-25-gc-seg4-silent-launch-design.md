# Google Classroom — Segment 4: Student Silent-SSO Launch (Design Spec)

**Status:** DECISIONS LOCKED (Marvin, 2026-06-25) — ready for writing-plans.
**Grounding:** `docs/superpowers/specs/grounding/2026-06-25-gc-seg4/grounding-synthesis.md` (V2 foundation + V1 reference, file:line-cited).
**Memory:** [[v2-google-classroom-epic]], [[v2-authoring-platform-program]].

## 1. Why / what
When a student taps the **"Open in CORE"** link pinned in their Google Classroom course (Seg 3 pinned `${APP_BASE_URL}/?gc=<type>&id=<id>`), they should land **authenticated** in CORE without a password — their Google identity (already signed in for Classroom) authenticates them, mapped via `external_identities` (Seg 2's Google-userId rows) to their CORE student account, then a CORE session is minted and they deep-link to the assignment. Builds on Seg 1 (OAuth + token vault), Seg 2 (roster + external_identities), Seg 3 (the pinned link). This is the **security-critical** segment — the launch link is public, so identity MUST come from Google, never from the link.

## 2. How it works (the model — V1-proven, reuses our primitives, zero new deps)
1. Student hits `${APP_BASE_URL}/?gc=<type>&id=<id>` (the Seg-3 link). Unauthenticated + `?gc=` present → the **proxy** redirects to the launch initiator (NOT `/login`).
2. **Launch initiator** `GET /api/auth/google/launch?gc=<type>&id=<id>` sets a one-time **nonce** cookie (httpOnly, sameSite=lax) and redirects to Google's OAuth consent with `prompt=none` (silent — the Classroom student is already in their Google session) and a **HMAC-signed `launch:` state** carrying the `?gc=` destination + nonce + 10-min expiry (signed with `GOOGLE_LAUNCH_STATE_SECRET`).
3. Google returns to the **existing** `/api/auth/google/callback`, which **branches on the `launch:` state prefix** (teacher-connect path unchanged). The student branch: verify state (HMAC + nonce-cookie timing-safe compare + TTL + delete nonce) → `exchangeCodeForTokens(code)` → `getGoogleProfile(token)` → **reject `verified_email:false`** → `resolveExternalIdentity(admin, {schoolId?, provider:'google', externalId: profile.id, email})` → CORE student id.
   - On `prompt=none` `interaction_required` → retry once interactively (`prompt=select_account`), V1 pattern.
4. **No match** → redirect to a friendly **`/launch/unmatched`** page ("we couldn't match your Google account — sign in with your CORE password, or ask your teacher"; link to `/login`). **Never auto-create** (resolveExternalIdentity is no-create; a public link must not mint accounts).
5. **Match** → **mint a CORE session** via `admin.auth.admin.generateLink({type:'magiclink', email})` → `supabase.auth.verifyOtp({token_hash, type:'magiclink'})` in the same request (sets the session cookies) — V1's exact mechanism, Supabase primitives V2 already runs in `/auth/callback`.
6. **Deep-link** (after re-validating the `?gc=id` resource belongs to the student's school/class — four-audience): assignment → `/student/assignments/<id>`; quiz → the student quiz surface (per-quiz deep-link is a follow-up — that route takes no id yet).

## 3. Locked decisions (Marvin, 2026-06-25)
- **Auth mechanism (applied, V1-proven):** silent "Sign in with Google" reusing the Seg-1 OAuth code flow (`getAuthUrl`/`exchangeCodeForTokens`/`getGoogleProfile`/`verified_email`), `prompt=none` → interactive fallback. Branch student-launch vs teacher-connect by the `launch:` state prefix. NO new dependency (no `jose`/`google-auth-library` — zero-dep HMAC via `node:crypto`, mirroring `signLaunchJwt.ts`).
- **Session minting (applied):** `admin.auth.admin.generateLink({type:'magiclink'})` → `verifyOtp` (port V1 `sso.ts`). NOT a custom JWT/session store.
- **No-match fallback (Marvin): a friendly `/launch/unmatched` page** (sign in with CORE password / ask your teacher; link to `/login`). Never auto-create.
- **Deep-link (Marvin): assignments deep-link now** (`/student/assignments/<id>`); **quizzes land on the student quiz surface** (per-quiz deep-link = a logged follow-up since `/student/quiz` has no id param). Always validate the resource belongs to the student first.
- **Proxy carve-out + secret (applied):** add ONLY the launch initiator (`/api/auth/google/launch`) + `/launch/unmatched` to the public set; the proxy redirects an unauthenticated `/?gc=...` to the launch initiator (instead of `/login`); the **callback stays login-gated for teacher-connect but accepts the signed `launch:` state** (branch internally — do NOT make the callback fully public). `GOOGLE_LAUNCH_STATE_SECRET` (32+ random bytes) = the HMAC key; set in Vercel at go-live.
- **Security posture (applied):** identity only from Google's verified profile, never link params; signed launch state (HMAC + one-time nonce httpOnly cookie + 10-min TTL + timing-safe compare); strict internal-path allow-list (`/student` destinations only; reject `//`, traversal, CRLF); re-validate the `?gc=id` resource is in the student's school/class before redirect; reject `verified_email:false`; normal CORE session lifetime.

## 4. Out of scope (deferred)
Per-quiz deep-link (extend `/student/quiz` to take an id — logged follow-up); Seg 5 Drive import; teacher/parent/admin launch (students only this segment); the DRAFT-courseWork-submissions spike (a Seg-3 post-merge check, separate). Re-pinning Seg-3 links is unnecessary — the path is unchanged; Seg 4 only changes `/?gc=`'s behavior.

## 5. Build shape (on sign-off → writing-plans)
1. **`src/lib/google/launchState.ts`** — `signLaunchState({gc, id, nonce})`/`verifyLaunchState(state)` via `node:crypto` HMAC-SHA256 + `GOOGLE_LAUNCH_STATE_SECRET`; 10-min TTL; timing-safe; the `launch:` prefix; internal-path allow-list. Pure, fully TDD'd. (Port V1 `launchState.ts` shape.)
2. **`GET /api/auth/google/launch`** — nonce cookie + `prompt=none` Google URL + signed launch state; redirect to Google. Add to `PUBLIC_PREFIXES`.
3. **Callback student branch** — extend `/api/auth/google/callback` to detect `launch:` state and run the student-launch flow (verify state+nonce → exchange → profile → verified_email → resolve → no-match redirect / mint session via generateLink+verifyOtp → validate resource ownership → deep-link). `interaction_required` → interactive retry. Teacher-connect path untouched.
4. **Proxy carve-out** (`src/proxy.ts`) — public the launch initiator + `/launch/unmatched`; unauthenticated `/?gc=...` → redirect to the launch initiator.
5. **Root `/?gc=` (authenticated)** (`src/app/page.tsx`) — when a session exists + `?gc=` present, deep-link directly (validate ownership) instead of the role redirect.
6. **`/launch/unmatched` page** — friendly no-match (public).
7. **Resource-ownership validation** helper — given (student, gc-type, id) confirm the assignment/quiz is in the student's class/school before deep-link.
8. **Go-live:** set `GOOGLE_LAUNCH_STATE_SECRET` in Vercel; add the launch redirect URI to the Google OAuth client if needed (the callback URI is already registered from Seg 1 — confirm `prompt=none` works with the existing client).

## 6. Constraints (binding)
- **Passwordless session = high blast radius** — the entire safety rests on Google's `verified_email` + the signed-state nonce/TTL. Trust NO link param for identity. Reject `verified_email:false`.
- **The link is public** — replay/CSRF via one-time nonce cookie + 10-min TTL + timing-safe HMAC. The proxy carve-out must be MINIMAL — never make the callback fully public; branch on signed state.
- **Four-audience** — after identity resolves, verify the `?gc=id` resource belongs to the student's school/class before deep-linking; a student sees only their own work.
- **No auto-create** on the launch path (resolveExternalIdentity is no-create by design).
- **Reuse Seg-1/2 primitives** (`exchangeCodeForTokens`, `getGoogleProfile`, `resolveExternalIdentity`, the `node:crypto` HMAC pattern from `signLaunchJwt`) — don't re-implement, don't add deps.
- **V1 is reference-only** — port the `launchState`/`sso` SHAPE, not the code.
- **Auth chain / proxy** — the student session is a normal Supabase session; `(student)` guards apply after launch.
- Process: writing-plans → **pre-code adversarial review** (security-critical — focus the review on the passwordless-session + public-link threat model) → subagent-driven TDD + per-task review → whole-branch review → Playwright preview (the unmatched page + a simulated launch) + go-live (set the secret) → Marvin merge. Gates: tsc 0, vitest green, build 0.
