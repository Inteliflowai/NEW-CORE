# V1 SSO Mechanics (Google + Clever) — Grounding

**Source repo:** `C:/users/inteliflow/core`
**Mined:** 2026-06-19 (read-only)
**Purpose:** Exact reference for porting V1's Google + Clever SSO to the V2 rebuild. Read before touching any SSO code in NEW-CORE. Complements `v1-01-login-design.md` and `v1-02-auth-mechanics.md`.

> **Headline:** V1 SSO is **custom hand-rolled OAuth**, NOT Supabase native providers. Sessions are minted via a magiclink trick (`admin.auth.admin.generateLink({type:'magiclink'})` → `verifyOtp`). It depends on **DB tables and `users` columns that do not exist in V2 yet** — a schema migration is a hard prerequisite.

---

## 1. Google domain-check endpoint

`app/api/auth/sso-config/route.ts`

```
GET /api/auth/sso-config?domain=<emailDomain>  →  { providers: string[] }
```

Backed by `getSchoolSsoConfig(domain)` in `lib/auth/sso.ts`, **database-driven**:
1. `school_domains` — `SELECT school_id WHERE domain = ?`
2. `sso_configs` — `SELECT provider WHERE school_id = ? AND enabled = true`
Returns `[]` if no domain match. Uses the admin (service-role) client.

## 2. Google OAuth initiation

`app/api/auth/google/route.ts` — hand-rolled, sets a CSRF state cookie then redirects to Google.

```
google_oauth_state cookie: crypto.randomUUID(), httpOnly, sameSite=lax, secure(prod), maxAge=600, path=/
Auth URL: https://accounts.google.com/o/oauth2/v2/auth
  client_id=GOOGLE_CLIENT_ID, redirect_uri=GOOGLE_REDIRECT_URI, response_type=code,
  scope='openid email profile', state, access_type=offline, prompt=select_account
```

`?mode=classroom` variant adds Classroom + Drive readonly scopes and `prompt=consent` (for refresh token), storing `google_oauth_mode=classroom` + a return-path cookie for callback branching. **Classroom scope-upgrade is a V1 teacher feature — out of scope for the V2 auth-entry build unless explicitly added.**

## 3. Google OAuth callback

`app/api/auth/google/callback/route.ts` — three branches keyed by cookies/state:

**Branch 1 — Login (default):**
1. Validate `state` against `google_oauth_state` cookie → fail → `/login?error=sso_failed`.
2. `exchangeGoogleCode(code)` → POST `https://oauth2.googleapis.com/token` (client_id/secret/redirect_uri/grant_type).
3. `getGoogleProfile(access_token)` → GET `https://www.googleapis.com/oauth2/v2/userinfo` → `{id,email,verified_email,name,picture}`.
4. `linkOrCreateUser(profile)` (see §5) → `{userId, role, isNew}`.
5. Store google tokens on `users` row (`google_access_token/refresh_token/token_expiry`).
6. `createSupabaseSessionForUser(userId)` (see §6).
7. Redirect to `ROLE_HOME[role]`.

**Branch 2 — Classroom connect:** attaches tokens to the *current* logged-in user (no new session); requires existing session. (Out of scope for auth-entry.)

**Branch 3 — Launch (silent SSO for Google Classroom student links):** `app/api/auth/google/launch/route.ts` + HMAC-signed state (`lib/integrations/lms/launchState.ts`, `INTERNAL_API_SECRET`). Resolves identity via `resolve_external_identity()` security-definer RPC against `external_identities`; **never auto-creates**, redirects to `/launch/unmatched` on miss. (Out of scope for auth-entry — this is the GC-launch feature.)

## 4. Clever SSO callback

Login button (client-side link): `https://clever.com/oauth/authorize?response_type=code&client_id=NEXT_PUBLIC_CLEVER_CLIENT_ID&redirect_uri=<APP_URL>/api/teacher/admin/sis/clever`.

`app/api/teacher/admin/sis/clever/route.ts`:
1. `CleverAdapter.exchangeCodeForToken(code, redirectUri)` → POST `https://clever.com/oauth/tokens` with **Basic** auth (`CLEVER_CLIENT_ID:CLEVER_CLIENT_SECRET`).
2. `CleverAdapter.fetchMe(token)` → GET `https://api.clever.com/v3.0/me` then `/{type}s/{id}` → `{id,type,district,email,name}`.
3. Look up `users` by `sis_external_id = clever.id AND sis_provider='clever'`; **email fallback** links Clever id to an existing email-matched user. **No auto-create** → miss → `/login?error=not_provisioned`.
4. Session via `admin.auth.admin.generateLink({type:'magiclink', email, options.redirectTo})` → redirect through `/auth/callback?token_hash=...&type=magiclink&next=ROLE_HOME[role]`.

Note the redirect-uri path `/api/teacher/admin/sis/clever` is V1-specific; V2 should use a clean route (e.g. `/api/auth/clever/callback`).

## 5. linkOrCreateUser (Google) — `lib/auth/sso.ts`

Resolution order:
1. `users.google_id = profile.id` → return.
2. `users.email = profile.email` → link `google_id` + `sso_provider='google'`, return.
3. **Create new:** detect school via `school_domains[domain]`; `admin.auth.admin.createUser({email, email_confirm:true, user_metadata})`; insert `users` row with **default role `'student'`**, `google_id`, `sso_provider='google'`.

> **V2 four-audience caution:** Google auto-creates a `student` account on first sign-in. That means any address in a configured Google domain can self-create a student. V2 must decide whether to keep auto-create or require pre-provisioning (Clever does NOT auto-create).

## 6. Session creation trick — `createSupabaseSessionForUser(userId)`

V1 has no password for SSO users. It mints a session by: `admin.auth.admin.getUserById` → `admin.auth.admin.generateLink({type:'magiclink', email})` → build an `@supabase/ssr` server client with the cookie adapter → `supabase.auth.verifyOtp({token_hash, type:'magiclink'})` (this writes the session cookies). Clever instead redirects the hashed_token through `/auth/callback` (which must handle `token_hash`+`type`).

## 7. Env vars

| Var | Exposure | Used for |
|---|---|---|
| `GOOGLE_CLIENT_ID` | server | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | server | Google token exchange |
| `GOOGLE_REDIRECT_URI` | server | Google callback URL |
| `NEXT_PUBLIC_CLEVER_CLIENT_ID` | client | Clever authorize link |
| `CLEVER_CLIENT_ID` / `CLEVER_CLIENT_SECRET` | server | Clever token exchange (Basic) |
| `NEXT_PUBLIC_APP_URL` | client | redirect_uri base |
| `INTERNAL_API_SECRET` | server | launch-state HMAC (GC launch only) |

## 8. DB dependencies (V1 — check against V2 schema!)

- **`school_domains`** (`school_id`, `domain` UNIQUE) — domain→school.
- **`sso_configs`** (`school_id`, `provider`, `enabled`, `config` jsonb) — which providers per school.
- **`users` columns:** `google_id`, `google_access_token`, `google_refresh_token`, `google_token_expiry`, `sso_provider`, `sis_external_id`, `sis_provider`. **In V1 these were added ad-hoc and are NOT all in version-controlled migrations.**
- `external_identities` + `resolve_external_identity()` — GC-launch only (out of scope).

## 9. Porting decisions flagged for V2

1. **Native Supabase OAuth vs custom?** Supabase native `signInWithOAuth` (Google) would be far simpler than V1's hand-rolled flow + magiclink session trick, and handles token refresh. Clever is not a Supabase native provider, so it stays custom (the magiclink→`/auth/callback?token_hash` pattern is the clean approach, and V2's callback must learn `token_hash`+`type` regardless — see `v1-02` gap C).
2. **Schema migration is a hard prerequisite** — `school_domains`, `sso_configs`, and the SSO `users` columns must be added in a V2 migration before any SSO route compiles against them.
3. **Auto-create policy** — decide Google auto-create (student) vs pre-provision-only. Clever is pre-provision-only.
4. **Domain→provider data source** — `sso_configs`/`school_domains` must be seeded for the Google button to ever appear (it is domain-gated on email blur).
5. **Route naming** — use `/api/auth/clever/callback` + `/api/auth/google/callback` in V2, not the V1 `/api/teacher/admin/sis/clever` path.
