# GC Segment 4 Grounding Synthesis (student silent-SSO launch)

> Gathered 2026-06-25 by 5 parallel readers (V2 auth/launch foundation + V1 reference) + opus synthesis. file:line-cited.

# GC Segment 4 — Student Silent-SSO Launch: Grounding Map

## 1. What exists today (V2)

**Identity map + resolve (BUILT, Seg 2).**
- `external_identities` table: `(school_id, provider, external_id, core_student_id)`, `UNIQUE(school_id, provider, external_id)`; Seg 2 added `email` + `last_seen_at` + email index (`supabase/migrations/0008_platform.sql:69-77`; `0024_gc_roster.sql:11-21`).
- `resolveExternalIdentity(admin, {schoolId, provider, externalId, email})` → `Promise<string | null>`. Resolution order: Google-`external_id` first (canonical), then unambiguous lowercased-email match (exactly one or null). **NEVER auto-creates** — the comment names Seg 4 as its intended consumer (`src/lib/google/resolveExternalIdentity.ts:4-5, 15-45`).

**Session/auth model — how a session is minted server-side.**
- Session cookies are written via the `@supabase/ssr` `setAll` hook on the server client (`src/lib/supabase/server.ts:11-20`), built on Next 16 async `cookies()` (`:6`).
- **Existing server-side session-establishing primitives:** `verifyOtp({type, token_hash})` and `exchangeCodeForSession(code)` in the auth callback (`src/app/auth/callback/route.ts:21, 37`). Both run server-side and set the cookies.
- **Pre-confirmed user creation:** roster import uses `admin.auth.admin.createUser({ email_confirm:true })` — no email link sent (`src/lib/trial/ensureAuthUser.ts:61-66`).
- **`admin.auth.admin.generateLink({type:'magiclink'})` is NOT used anywhere in V2** (inferred — no call site; this is the standard server primitive to mint a session for a known user).
- **SPARK precedent — the closest passwordless launch pattern in V2:** hand-rolled HS256 JWT via `node:crypto createHmac`, no `jsonwebtoken` dep, 15-min TTL, claims `core_user_id`/`core_school_id`/etc., returns a `launch_url?token=…&redirect=…` (`src/lib/spark/signLaunchJwt.ts:4,21-23`; `src/app/api/attempts/spark-launch/route.ts:45-55`). Note: SPARK *consumes* the JWT on its side — it does not mint a Supabase session in CORE.

**Proxy gate + student guards.**
- `PUBLIC_PREFIXES = ['/login','/set-password','/logout','/auth','/trial-expired']`; everything else requires a session (`src/proxy.ts:5-10`). Proxy uses `getUser()` and redirects unauthenticated `/` → `/login`, other private paths → `/login?expired=true` (`:34-58`).
- `(student)/layout.tsx:13` calls `await requireRole(['student'])`; `requireRole` resolves `getUser()`, fetches `users.role`/`school_id`, checks `trial_status`, redirects on failure (`src/lib/auth/requireRole.ts:19-38`).
- `/api/auth/google/callback` is **NOT** in `PUBLIC_PREFIXES` → login-gated today (correct for teacher connect).

**Open-CORE link + `?gc=` param.**
- Seg 3 publishes resource link `${APP_BASE_URL}/?gc=<quiz|assignment>&id=<quizzes.id|lessons.id>` and course link `${APP_BASE_URL}/` (`src/app/api/teacher/google/publish/route.ts:73-74`). `APP_BASE_URL = NEXT_PUBLIC_APP_URL || 'https://newcore.inteliflowai.com'`, trailing slash stripped (`src/lib/google/config.ts:13`).
- **Nothing reads `?gc=` today.** Root `/` (`src/app/page.tsx:1-12`) redirects by role via `homeForRole()` (student → `/student/dashboard`), ignoring `?gc=`. The link deliberately targets the real login-gated root — "NO invented /launch route (Seg 4 upgrades the behavior, not the path)" (`config.ts:11-12`).

**Student surfaces.** `/student/dashboard`, `/student/assignments`, `/student/assignments/[id]` (id = DB row id), `/student/assignments/[id]/play`, `/student/quiz` (**single page, NO `[id]` param**), `/student/growth` (`(student)/layout.tsx`; route glob).

**Google-identity-verification primitives.**
- **EXISTS:** OAuth code→token exchange (`exchangeCodeForTokens`, `src/lib/google/tokens.ts:13-27`, zero-dep fetch) + `getGoogleProfile(accessToken)` → raw fetch to `…/oauth2/v2/userinfo` returning `{id,email,name,verified_email}` (`src/lib/google/profile.ts:4-11`). CSRF-state pattern + unverified-email rejection already proven in the teacher callback (`callback/route.ts:30,37,47`).
- **NET-NEW / ABSENT:** No Google **ID-token** (JWT) verification anywhere; **no `jose`/`google-auth-library`/`jsonwebtoken`** in V2 `package.json`. No JWKS client. No `prompt=none` silent-auth call. No `/api/auth/google/launch` route. `GOOGLE_LAUNCH_STATE_SECRET` is **not yet set in Vercel** and unused (inferred — deferred to this segment).

---

## 2. THE SESSION-MINTING VERDICT

**Plain fact:** the only server-side primitives V2 has to log a known user in *without a password* are Supabase's token verifiers — **`verifyOtp` and `exchangeCodeForSession`** (`auth/callback/route.ts:21,37`). To use `verifyOtp` for an arbitrary mapped student you generate the token with **`admin.auth.admin.generateLink({type:'magiclink', email})`** (service-role) and immediately `verifyOtp` it in the same request to set cookies — this is exactly V1's mechanism (see §4) and is the **strongly recommended path**.

**Closest existing precedent:** the `/auth/callback` route itself — it already takes a token/code and calls the verifier to mint cookies. Seg 4's launch callback is a sibling of this. SPARK's HS256 JWT (`signLaunchJwt.ts`) is a precedent for *handing off* identity to another app, **not** for minting a CORE Supabase session — do not copy it for the session itself (it would require building a custom session store CORE doesn't have).

---

## 3. THE IDENTITY-VERIFICATION VERDICT

**The threat:** the Open-CORE link is **public** (anyone in the Classroom stream, or anyone who copies the URL, hits it). Identity must come from **Google**, never from the link.

**What exists (recommended reuse):** the **full OAuth authorization-code flow** already built for teachers — `getAuthUrl` → Google consent → `/api/auth/google/callback` → `exchangeCodeForTokens` → `getGoogleProfile` → `verified_email` check (`tokens.ts`, `profile.ts`, `callback/route.ts`). The `profile.id` (Google userId) is what `resolveExternalIdentity` matches on. This proves the arriving person controls the Google account. **Zero new dependencies.** For a Classroom student already signed into Google, `prompt=none` (silent) makes this near-frictionless (V1 does exactly this — §4).

**The net-new alternative (not recommended for pilot):** Google **One-Tap / ID-token** verification would require adding `jose` or `google-auth-library` (or hand-rolling JWKS against Google's public keys building on the `signLaunchJwt` crypto pattern) — all net-new in V2. More moving parts, new dep, no payoff over reusing Seg-1 primitives.

**Verdict:** reuse the Seg-1 OAuth code flow. The student-launch branch is distinguished from teacher-connect by the **state prefix** (V1 uses a `launch:` prefix on the signed state, branching in the shared callback — `callback/route.ts:49-50`).

---

## 4. V1 reference (the proven blueprint)

- **Entry:** `/launch/home` redirects unauthenticated users to `/api/auth/google/launch?next=…` (`app/(public)/launch/home/page.tsx:27-28`).
- **Silent SSO:** launch route builds a Google URL with **`prompt=none`** for students already in their Google session; on `interaction_required` it retries once interactively with `prompt=select_account` (mode flip) (`app/api/auth/google/launch/route.ts:41`; `callback/route.ts:143-147`).
- **Session minting:** `admin.auth.admin.generateLink({type:'magiclink', email})` then `supabase.auth.verifyOtp({token_hash, type:'magiclink'})` in the same request to set cookies (`lib/auth/sso.ts:186-214`). **This is the pattern to port.**
- **Identity match:** SECURITY DEFINER RPC `resolve_external_identity(provider, external_user_id, email)` — Google ID first, else email only if exactly one match (`callback/route.ts:166-170`; `migrations/074_lms_connector.sql:61-75`). V2's `resolveExternalIdentity.ts` is the already-ported equivalent.
- **State / CSRF / replay:** HMAC-SHA256 signed state via `INTERNAL_API_SECRET`, `launch:` prefix, **10-min TTL**, random **nonce in httpOnly+sameSite=lax cookie** embedded in state and verified (timing-safe) + deleted on callback (`lib/integrations/lms/launchState.ts:30,52-92`; `callback/route.ts:128-131`).
- **Strict internal-path allow-list:** destination must match `^/(launch|student|teacher|parent|admin|platform)(/|\?|$)`, rejects `//`, traversal, CRLF; validated at **both** launch init and callback (`launchState.ts:37-44,93`).
- **No auto-create:** unmatched Google account → `/launch/unmatched`, never creates a student (`callback/route.ts:175-179`).
- V1's `INTERNAL_API_SECRET` is **absent in V2** → that role is exactly what `GOOGLE_LAUNCH_STATE_SECRET` fills.

---

## 5. What does NOT exist (the Seg 4 gaps)

1. No `/api/auth/google/launch` route (silent-auth initiator + `prompt=none`/interactive fallback).
2. No student branch in `/api/auth/google/callback` (today: teacher-connect only).
3. No `?gc=` reader anywhere — root `/` ignores it (`page.tsx:1-12`).
4. No launch-state signer/verifier (`GOOGLE_LAUNCH_STATE_SECRET` unused; no nonce cookie; no internal-path allow-list in V2).
5. No proxy carve-out for the unauthenticated launch path.
6. No session-minting call (`generateLink`+`verifyOtp`) wired for students.
7. No "no-match / not-linked" student page (V1's `/launch/unmatched` equivalent).
8. No `/student/quiz/[id]` deep-link target — quiz is a single param-less page, so `?gc=quiz&id=…` has nowhere specific to land yet.

---

## 6. Design decisions Marvin must make

**D1 — How does the student prove who they are?**
*Plain question:* When a student taps "Open in CORE" from Google Classroom, how do we confirm it's really them and not someone who copied the link?
- (a) **Send them through "Sign in with Google" using the same Google connection we already built — and because they're already logged into Google for Classroom, it happens silently with no click** (V1's `prompt=none`, fall back to one tap if Google needs it). Reuses Seg-1 code, zero new dependency.
- (b) Google One-Tap / ID-token check — needs a new library, more to build/maintain.
- **Recommended: (a).** It is the V1-proven, truly-silent path and reuses primitives we already ship; (b) buys nothing for a pilot and adds a dep.

**D2 — What actually logs them into CORE once we know who they are?**
*Plain question:* After Google confirms the student, what creates their CORE login session?
- (a) **Server generates a one-time magic-link token for that student and immediately redeems it to set the session cookie** (`generateLink`+`verifyOtp`) — V1's exact mechanism, uses Supabase primitives V2 already has.
- (b) A custom launch token like SPARK's JWT — but CORE has no custom session store, so this means building one. More work, off-pattern.
- **Recommended: (a).** It is the only path that mints a real Supabase session with code we already run in `/auth/callback`.

**D3 — What if the student has no Google link in CORE (file-roster kid, or not yet synced)?**
*Plain question:* A student whose CORE account isn't connected to a Google identity clicks the link — what do they see?
- (a) **A friendly "We couldn't match your Google account — sign in with your CORE password, or ask your teacher" page** (V1's `/launch/unmatched`), with a link to normal `/login`.
- (b) Silently fall through to `/login`.
- (c) Auto-create an account.
- **Recommended: (a).** Mirrors V1, keeps the door open without confusion. **Never (c)** — `resolveExternalIdentity` is explicitly no-auto-create, and auto-create on a public link is an account-injection hole.

**D4 — After login, where do they land?**
*Plain question:* Should the link drop them on the exact assignment/quiz, or just their dashboard?
- (a) **Deep-link to the specific item** from `?gc=<type>&id=<id>` — assignment → `/student/assignments/<id>`; quiz → needs a target (quiz page is param-less today, so either add `/student/quiz?id=` handling or land on the quiz list).
- (b) Always land on `/student/dashboard`.
- **Recommended: (a) for assignments now; for quizzes, land on the quiz surface and treat per-quiz deep-link as a small follow-up** (the route doesn't take an id yet). Validate the id belongs to the student's school/class before redirect (see D6).

**D5 — What gets exempted from the login wall, and what is `GOOGLE_LAUNCH_STATE_SECRET` for?**
*Plain question:* The launch has to work before the student is logged in — which URLs do we let through the gate, and what's the new secret?
- The launch **initiator** and the **callback** must be reachable with no session. Options: add a narrow prefix (e.g. `/api/auth/google/launch`) to `PUBLIC_PREFIXES`, and have the **existing** `/api/auth/google/callback` branch internally on a signed `launch:` state (so it stays login-gated for the teacher path but accepts the signed student launch). `GOOGLE_LAUNCH_STATE_SECRET` = the HMAC key that signs the launch state (carrying the `?gc=` destination + nonce), giving CSRF binding, 10-min TTL, and replay protection — the role V1's `INTERNAL_API_SECRET` played.
- **Recommended:** carve out **only** the launch initiator path; branch the shared callback on the `launch:` state prefix (V1 pattern) rather than making the callback fully public. Set `GOOGLE_LAUNCH_STATE_SECRET` (32+ random bytes) in Vercel as part of this segment.

**D6 — Public-link security posture.**
*Plain question:* How do we make sure the public link can't be abused (replayed, forged, or used to peek at another kid's work)?
- Identity comes **only** from Google's verified profile, never from link params. Sign launch state (HMAC + nonce httpOnly cookie + 10-min TTL + timing-safe compare). Allow-list redirect destinations to internal `/student/...` paths only (reject `//`, traversal, CRLF). After mapping, **re-validate the `id` belongs to the student's school/class** before deep-linking (four-audience: students see only their own work). Session lifetime = normal CORE session.
- **Recommended:** port V1's `launchState` shape wholesale (`launchState.ts`), restrict the allow-list to `/student`, and add the school/class ownership check on the `?gc=id` before redirect.

---

## 7. Risks / constraints

- **Passwordless session = high blast radius.** The session is real and full-privilege; the entire safety rests on (a) Google verifying the email/`verified_email`, and (b) the signed-state nonce/TTL. Do **not** trust any link param for identity. Reject `verified_email:false` (the teacher callback already does — `callback/route.ts:47`).
- **The link is public.** Replay/CSRF: one-time nonce cookie + 10-min TTL + timing-safe HMAC (V1 proven). The proxy carve-out must be **minimal** — exempting too broad a prefix (e.g. all of `/api/auth`) or making the callback fully public would open a hole; branch on signed state instead.
- **Four-audience.** Students see only their own work — after identity resolves, verify the `?gc=id` resource is in the student's school/class before deep-linking; never expose another student's assignment/quiz.
- **Reuse Seg-1/2 primitives.** `exchangeCodeForTokens`, `getGoogleProfile`, `resolveExternalIdentity` are all built and reviewed — reuse, don't re-implement. The Google identity anchor is the `external_id` (Google userId) rows Seg 2 writes; email is the unambiguous fallback.
- **No auto-create on the launch path** — `resolveExternalIdentity` is no-create by design; auto-create would let a public link mint accounts.
- **V1 is reference-only** (`C:/users/inteliflow/core`) — its `resolve_external_identity` RPC and `launchState.ts` are blueprints; V2's equivalents differ (zero-dep crypto, `external_identities` shape per migrations 0008/0024).
- **Pilot-friendliness.** `prompt=none` silent launch = near-zero friction for a Classroom student already in their Google session; the `/launch/unmatched`-style fallback prevents dead ends for file-roster students.
- **Quiz deep-link gap.** `/student/quiz` takes no id today — `?gc=quiz&id=` has no precise target; either extend the route or accept list-landing as a documented follow-up.

**Files of record (V2):** `src/lib/google/{resolveExternalIdentity,config,profile,tokens,oauthUrls}.ts`, `src/app/api/auth/google/callback/route.ts`, `src/app/api/teacher/google/publish/route.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts`, `src/lib/auth/requireRole.ts`, `src/lib/trial/ensureAuthUser.ts`, `src/lib/spark/signLaunchJwt.ts`, `src/app/page.tsx`, `src/app/(student)/layout.tsx`, `supabase/migrations/{0008_platform,0024_gc_roster}.sql`, `docs/superpowers/specs/2026-06-23-google-classroom-design.md`. **V1 reference:** `app/api/auth/google/{launch,callback}/route.ts`, `lib/auth/sso.ts`, `lib/integrations/lms/launchState.ts`, `supabase/migrations/074_lms_connector.sql`.