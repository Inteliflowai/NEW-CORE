# V1 Login Page — Design Grounding

Source snapshot taken: 2026-06-19
Files read verbatim:
- `C:/users/inteliflow/core/app/login/page.tsx`
- `C:/users/inteliflow/core/lib/brand.ts`
- `C:/users/inteliflow/core/lib/i18n/en.ts` (auth section)
- `C:/users/inteliflow/core/app/globals.css`
- `C:/users/inteliflow/core/app/auth/callback/route.ts`

---

## 1. Overall Layout

**Centered card over full-bleed background. Not split-screen.**

The entire viewport is occupied by a full-bleed rotating background. Over it, centered both horizontally and vertically, sits a single frosted-glass card (max-width 400 px, padding 2 rem). There is no sidebar, no left/right panel split. The layout is:

```
[full-viewport rotating background]
  └── [fixed dark gradient overlay — radial, heavier at edges]
       └── [fixed grain texture — opacity 0.03]
  └── [centered flex column, z-index 10, min-height 100vh]
       ├── [optional session-expired amber toast — appears above card]
       └── [frosted glass card 400 px wide]
            ├── Logo area + platform subtitle
            ├── Mode toggle pill (Password | Magic Link)
            ├── Error/success message banner
            ├── Form (email + conditionally password)
            ├── Submit button
            ├── SSO divider + optional Google button (domain-triggered)
            └── Clever SSO button (always visible)
       └── [footer text, below card]
```

Mobile: The card is full-width with 1 rem horizontal padding on the outer container. No breakpoint restructuring — same centered card, just narrower on small screens. Font sizes are set to 16 px on inputs specifically to prevent iOS Safari's auto-zoom on focus.

---

## 2. Full-Bleed Slideshow Background

### Image files

Five JPEG files live at `public/images/login/`:

| Filename | Caption (i18n key `auth.imageCaptions[i]`) |
|---|---|
| `login-classroom-ai.jpg` | "The future of education is brilliantly personal." |
| `login-student-before-after.jpg` | "Every student has the potential to transform." |
| `login-brain-ai.jpg` | "Intelligence flows in every direction." |
| `login-learning-paths.jpg` | "Every mind is an explosion waiting to happen." |
| `login-student-discovery.jpg` | "Learning is the most colorful adventure." |

All are referenced via public paths (`/images/login/login-*.jpg`) and set as `background-image: url(...)` on `<div>` elements — not `<img>` tags, so Next.js `<Image>` optimization does not apply.

### Transition / interval logic

Component: `<BackgroundRotator />` — a `'use client'` component rendered inside the page.

- **Interval:** 7000 ms (constant `INTERVAL = 7000`).
- **Transition type:** slide-left. A `200%`-wide flex container holds the current image (left 50 %) and the next image (right 50 %). When advancing, a CSS `@keyframes login-slide` animation fires (`translateX(0)` → `translateX(-100%)`, duration 1 s, `ease-in-out`, `forwards`). After 1000 ms the `current` index increments and the slide state resets.
- **State:** `current` (0–4) and `sliding` (boolean). `useRef` timer pattern — `setTimeout` not `setInterval`; timer is cleared on cleanup.
- **Navigation dots:** Five pill dots bottom-right. Active dot is 20 × 6 px rounded pill (white 90 % opacity); inactive dots are 6 × 6 px circles (white 35 % opacity). Width transitions with `transition: all 0.4s ease`. Dots are clickable to jump directly to any image (disabled during `sliding`).
- **Caption:** Bottom-left, 12 px `DM Sans`, white 50 % opacity, text-shadow. Fades out during slide (`opacity: 0` when `sliding`, `transition: opacity 0.5s ease`).

### Overlays (stacked on top of images, all `position: fixed`)

1. **Dark radial gradient** (z-index 1): `radial-gradient(ellipse 60% 60% at 50% 50%, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.45) 100%)`. Center is lighter; edges are darker (vignette effect).
2. **Grain texture** (z-index 2, `pointer-events: none`): SVG `feTurbulence` fractalNoise at 0.03 opacity, 128 px tile repeat. Very subtle film-grain effect.

---

## 3. Frosted Glass Card

```
background:      rgba(8,12,24,0.35)
backdropFilter:  blur(24px)
border:          1px solid rgba(255,255,255,0.1)
borderRadius:    24px
padding:         2rem
boxShadow:       0 24px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)
animation:       cardIn 0.7s 0.15s ease both (on mount)
```

`cardIn` keyframes: `opacity: 0; transform: translateY(24px) scale(0.98)` → `opacity: 1; translateY(0) scale(1)`.

---

## 4. Branding — Logo Area

Inside the card, top section:

```
display:       flex column, align items center
marginBottom:  1.75 rem
paddingBottom: 1.5 rem
borderBottom:  1px solid rgba(255,255,255,0.07)
```

The logo is rendered as `<img src={brand.logo} alt={brand.name} />` where `brand.logo = '/core-logo.png'` (V1 has `core-logo.png`, `core-logo-white.png`, and `core-logo-BLACK.jpeg` in `public/`). The `<img>` is 96 px tall, `object-fit: contain`. It is wrapped in a `position: relative` container that has an animated pulsing ring:

```
position: absolute; inset: -8px; border-radius: 8px;
border: 1px solid rgba(255,255,255,0.12);
animation: pulse-ring 3s ease-out infinite;
```

`pulse-ring` keyframes: `scale(0.95) opacity 0.6` → `scale(1.05) opacity 0` → `scale(0.95) opacity 0`.

Below the logo:
```
fontSize:       11px
fontWeight:     600
color:          rgba(255,255,255,0.3)
letterSpacing:  0.12em
textTransform:  uppercase
content:        t.footer.platformSubtitle  (i18n key)
```

There is no large headline or marketing copy inside the card. The brand statement is carried by the image captions on the background.

---

## 5. Sign-In Form

### Mode toggle

A segmented pill control with two options: **"Password"** (`t.auth.password`) and **"Magic Link"** (`t.auth.magicLink`). A third mode, `'forgot'`, replaces the pill with a "back" chevron + reset-password heading. The toggle is:

```
background:   rgba(255,255,255,0.05)
borderRadius: 10px
padding:      3px
border:       1px solid rgba(255,255,255,0.06)
```

Active pill: `background: rgba(255,255,255,0.12)`, `color: #f8fafc`, `boxShadow: 0 1px 4px rgba(0,0,0,0.2)`.
Inactive pill: `background: transparent`, `color: rgba(255,255,255,0.35)`.

### Form fields

**Email field** (all modes):
- Label: 11 px, 600 weight, `rgba(255,255,255,0.35)`, uppercase, 0.07 em letter-spacing.
- Input class `.login-input`: `padding: 12px 16px`, `border-radius: 12px`, `border: 1px solid rgba(255,255,255,0.12)`, `background: rgba(255,255,255,0.06)`, `color: #f8fafc`, `font-size: 16px` (iOS zoom prevention), `DM Sans`.
- Focus: `border-color: rgba(255,255,255,0.4)`, `background: rgba(255,255,255,0.1)`.
- Placeholder: `rgba(255,255,255,0.25)`.
- `placeholder` text: `t.auth.emailPlaceholder` = `"you@school.edu"`.
- `onBlur` calls `checkSsoProviders` — triggers SSO domain lookup.

**Password field** (mode = 'signin' only):
- Label row: label left + **"Forgot?"** (`t.auth.forgotPassword`) button right — clicking switches to `'forgot'` mode.
- Input is password type with a **show/hide toggle** button (SVG eye icon) absolutely positioned right inside the input at right 10 px. Toggles `type` between `'password'` and `'text'`.
- `autoComplete="current-password"`.
- Placeholder: `"••••••••"` (hardcoded, not i18n'd).

**Magic link hint** (mode = 'magic'):
- 12 px, `rgba(255,255,255,0.3)`, i18n string `t.auth.magicLinkHint` = `"We'll email you a one-click link. No password needed."`.

**Forgot password mode**:
- Back link arrow: `←` + `t.auth.backToSignIn`, `rgba(255,255,255,0.4)`, 12 px.
- Heading: `t.auth.resetPassword` = `"Reset your password"`, 18 px, 700 weight, `#f8fafc`.
- Hint: `t.auth.resetPasswordHint` = `"Enter your email and we'll send you a reset link."`, 13 px, `rgba(255,255,255,0.4)`.

### Submit button

Class `.login-btn`:
- Default (not loading): `background: rgba(255,255,255,0.92)`, `color: #0a0e1a` (near-black), `boxShadow: 0 4px 20px rgba(255,255,255,0.15)`.
- Loading: `background: rgba(255,255,255,0.08)`, `color: rgba(255,255,255,0.3)`, `cursor: not-allowed`.
- Hover (not disabled): `transform: translateY(-1px)`. Active: `translateY(0)`.
- Labels by mode: `"Sign in to CORE"` / `"Send magic link"` / `"Send reset link"` / `"Please wait…"` (loading).

### Error and success messages

Single banner above the form:
- Error: `background: rgba(239,68,68,0.12)`, `border: 1px solid rgba(239,68,68,0.25)`, `color: #fca5a5`.
- Success: `background: rgba(16,185,129,0.12)`, `border: 1px solid rgba(16,185,129,0.25)`, `color: #6ee7b7`.
- 13 px, `lineHeight: 1.5`, `padding: 11px 14px`, `borderRadius: 10px`.

Error variants (from `?error=` query param):
- `auth_failed`, `sso_failed`, `not_provisioned`, `clever_sso_failed`.

**Session expired toast** (from `?expired=true`): amber coloring (`rgba(245,158,11,0.15)` bg, `rgba(245,158,11,0.3)` border, `#fcd34d` text). Auto-dismisses after 5000 ms. Appears above the card, not inside it.

---

## 6. SSO Buttons

### Google (conditional, domain-triggered)

When the user blurs the email field, `checkSsoProviders` fires a `fetch` to `/api/auth/sso-config?domain=...`. If the response includes `'google'` in providers, the Google button appears:

```
background:    rgba(255,255,255,0.92)
border:        1.5px solid rgba(255,255,255,0.2)
color:         #1c1917
borderRadius:  12px
padding:       12px
```

Google G logo is an inline SVG (the four-path official Google colors). Button text: `t.auth.continueWithGoogle` = `"Continue with Google"`. Links to `/api/auth/google`.

### Clever (always visible)

```
background:    rgba(75,134,244,0.15)
border:        1.5px solid rgba(75,134,244,0.3)
color:         #93bbfc
borderRadius:  12px
```

Clever logo: inline SVG blue rounded-rect with "C" text. Button text: `t.auth.continueWithClever` = `"Log in with Clever"`. Links to `https://clever.com/oauth/authorize?...` with `NEXT_PUBLIC_CLEVER_CLIENT_ID` and `NEXT_PUBLIC_APP_URL`.

### Divider between SSO sections

`"or continue with"` (`t.auth.orContinueWith`) flanked by 1 px `rgba(255,255,255,0.1)` lines. 11 px, `rgba(255,255,255,0.25)`.

---

## 7. Footer

Below the card (outside it):
```
fontSize:      11px
color:         rgba(255,255,255,0.2)
letterSpacing: 0.05em
textAlign:     center
marginTop:     1.5rem
content:       "CORE · Inteliflow AI · FERPA compliant"
```

---

## 8. Typography

- **Primary font:** `DM Sans` (Google Fonts, weights 300/400/500/600/700). Loaded via `<style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:...')` injected inline in the page component.
- **Display accent:** `Syne` (weights 700/800) — imported alongside DM Sans but not visibly used in the login card itself. Present for future use.
- Labels: 11 px / 600 / uppercase / 0.07 em spacing.
- Body/inputs: 16 px (inputs), 13–14 px (hints, messages).
- Heading (forgot mode): 18 px / 700.

---

## 9. Color Palette (login page — distinct from V1 dashboard tokens)

The login page does NOT use V1's CSS custom property system (`--bg`, `--primary`, etc.). All values are hardcoded inline styles. Key values:

| Role | Value |
|---|---|
| Page background fallback | `#050810` (Suspense fallback) |
| Dark canvas (card background) | `rgba(8,12,24,0.35)` |
| Text primary | `#f8fafc` |
| Text dim | `rgba(255,255,255,0.3–0.5)` |
| Submit button background | `rgba(255,255,255,0.92)` |
| Submit button text | `#0a0e1a` |
| Error color | `#fca5a5` (text), `rgba(239,68,68,0.12)` (bg) |
| Success color | `#6ee7b7` (text), `rgba(16,185,129,0.12)` (bg) |
| Clever brand | `rgba(75,134,244,...)` / `#93bbfc` |

There is no indigo/cobalt accent on the login page. The V1 dashboard primary is `#6366f1` (indigo) but the login page uses white/near-black as the only solid accent.

---

## 10. Animations Summary

| Name | Where | Duration | Effect |
|---|---|---|---|
| `login-slide` | Background rotator | 1 s ease-in-out | Translate container −100 % (slide left) |
| `cardIn` | Frosted card | 0.7 s, 0.15 s delay | fade-in + translateY(24px)→0 + scale(0.98→1) |
| `logoIn` | Defined but unused | 0.6 s | Defined in `<style>` but no element applies it |
| `pulse-ring` | Logo ring | 3 s infinite | scale + opacity pulse |
| Caption fade | Caption text | 0.5 s | opacity 1→0 on slide start |
| Dot width | Navigation dots | 0.4 s | Active dot widens to 20 px pill |

---

## 11. Auth Flows Wired Up

| Flow | Trigger | Handler | Post-auth redirect |
|---|---|---|---|
| Password sign-in | Form submit (mode='signin') | `supabase.auth.signInWithPassword` | Reads `users.role` → `ROLE_HOME` map |
| Magic link | Form submit (mode='magic') | `supabase.auth.signInWithOtp` | Email link → `/auth/callback` |
| Forgot password | Form submit (mode='forgot') | `supabase.auth.resetPasswordForEmail` | Email link → `/auth/callback?next=/reset-password` |
| Google OAuth | Click Google button | `/api/auth/google` | → `/auth/callback` → role home |
| Clever OAuth | Click Clever button | `https://clever.com/oauth/authorize` | → `/api/teacher/admin/sis/clever` |

`ROLE_HOME` map:
```
teacher        → /teacher
student        → /student
parent         → /parent
school_admin   → /admin
platform_admin → /platform
```

Auth callback (`app/auth/callback/route.ts`) handles both `token_hash` (password reset, email verify via `verifyOtp`) and `code` (OAuth, magic link via `exchangeCodeForSession`), then reads `users.role` and redirects.

The V1 client is created with `createClient` from `@/lib/supabase/client` (the browser client). V2 uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; V1 uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 12. Component Structure

```
LoginPage (default export)
  └── <Suspense fallback={<div style={{ background: '#050810' }} />}>
       └── LoginPageInner  ('use client')
            ├── <BackgroundRotator />   ('use client', inline component)
            │    ├── <style> @keyframes login-slide </style>
            │    ├── div[position:fixed] — two-image flex slider
            │    ├── div[position:fixed] — radial gradient overlay
            │    ├── div[position:fixed] — grain texture
            │    ├── p — caption (bottom-left)
            │    └── div — dot indicators (bottom-right)
            └── <style> @import DM Sans / Syne + card/input/button keyframes </style>
            └── div[centered flex column, z-index 10]
                 ├── [conditional] session-expired amber toast
                 └── div[frosted glass card]
                      ├── div[logo + subtitle]
                      ├── [conditional] mode-toggle pill
                      ├── [conditional] forgot-password header
                      ├── [conditional] error/success message
                      ├── <form>
                      │    ├── email input (always)
                      │    ├── [conditional] password input + show-hide toggle
                      │    ├── [conditional] magic link hint text
                      │    └── submit button
                      ├── [conditional] Google SSO section
                      └── Clever SSO section
                 └── footer <p>
```

---

## 13. Image Assets to Port

All five files from `C:/users/inteliflow/core/public/images/login/` must be copied to `C:/users/inteliflow/NEW-CORE/public/images/login/`:

```
login-classroom-ai.jpg
login-student-before-after.jpg
login-brain-ai.jpg
login-learning-paths.jpg
login-student-discovery.jpg
```

---

## 14. Critical Gaps — What Will NOT Port Cleanly to V2

### G1. Logo: PNG file vs. text mark

V1 renders `<img src="/core-logo.png" height="96px" />`. V2 has no `core-logo.png` in `public/` and the V2 brand identity uses a **text mark** — "diamond CORE" — not a PNG logo. The logo area code must be replaced entirely with the V2 text mark component (or a `<span>` implementing the diamond + wordmark). The pulse-ring animation box can be reused, but the `<img>` tag cannot.

### G2. Font loading: Google Fonts `@import` vs. `next/font/google`

V1 injects `DM Sans` and `Syne` via an inline `<style>@import url('https://fonts.googleapis.com/...')`inside the component. V2 uses `next/font/google` in `layout.tsx` (`Bricolage_Grotesque` as `--font-bricolage`, `Inter` as `--font-sans`). The login page must use V2's declared font variables (`var(--font-sans)` for body, `var(--font-display)` for display text) rather than importing DM Sans and Syne separately. The visual result will differ: V1 uses DM Sans (geometric humanist) as body and Syne (geometric display) as headline; V2 uses Inter as body and Bricolage Grotesque as display.

### G3. Color tokens: hardcoded inline hex vs. cobalt token system

Every color in the V1 login page is hardcoded as inline styles. V2 has a strict token system (Tier 1 primitive ramps → Tier 2 semantic slots → Tier 3 role/intensity binding via `data-role`/`data-intensity` attributes) exposed as Tailwind v4 utilities. The WCAG-AA contrast gate (`npm run prebuild` → `npm run a11y`) will **exit 1** on any hardcoded hex or color-name literal in components. V2's login page must use token references only: `var(--cobalt-950)` for the dark card canvas, `var(--white)` or `var(--ink-50)` for text, `var(--cobalt-500)` for any brand accent, etc. The login page has no `data-role` set (it is pre-auth), so the default Tier-2 defaults (cobalt-600 brand, ink-50 bg) will apply; the dark-mode card needs to hard-set its canvas color via a Tier-1 primitive directly on the element.

### G4. Tailwind v4 — no utility class names for inline styles

V1 uses zero Tailwind classes on the login page — it is 100 % inline `style={{}}` objects. V2's project uses Tailwind v4 (`@import "tailwindcss"`, `@theme inline` block, no `tailwind.config.js`). V2 components must use Tailwind utility classes or `var()` references via CSS modules / `@apply`, not `style={{}}` for structural/layout CSS. The inline-style approach from V1 will technically work but violates the V2 constraint and cannot use the token utilities (`bg-brand`, `text-fg`, `shadow-pop`, `rounded-lg`, etc.).

### G5. `@supabase/client` env var name changed

V1's `createClient` (browser Supabase) reads `NEXT_PUBLIC_SUPABASE_ANON_KEY`. V2's equivalent reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (confirmed in `p4b-02-auth.md`). The login page's `signInWithPassword`, `signInWithOtp`, and `resetPasswordForEmail` calls need the V2 client factory, not a direct import of V1's `@/lib/supabase/client`.

### G6. SSO domain-check endpoint: `/api/auth/sso-config` does not exist in V2

V1 has `app/api/auth/sso-config/route.ts` that returns `{ providers: string[] }` for a given domain. This endpoint is not ported yet. If Google SSO domain detection is kept in V2, this route must be built. If omitted for now, the `onBlur` domain-check call and the conditional Google button section can be deferred to a later phase.

### G7. Clever SSO references V1-specific env vars and redirect path

The Clever button href references `NEXT_PUBLIC_CLEVER_CLIENT_ID` and redirects to `/api/teacher/admin/sis/clever` — a V1 path. V2 does not have that API route. Clever SSO must be either deferred or re-wired to a V2 Clever callback route.

### G8. No i18n system in V2

V1 uses `useTranslations()` from `lib/i18n` (a locale-keyed object). V2 has no i18n system yet. All string literals must be inlined directly in V2's login component, with the en-locale values from V1 (`lib/i18n/en.ts`, `auth:` section) used as the source of truth. The auth string set is documented in Section 5 above.

### G9. Role set mismatch: `school_sysadmin`

V1's `ROLE_HOME` map has 5 roles: `teacher, student, parent, school_admin, platform_admin`. V2's canonical `ROLES` type adds `school_sysadmin`. The post-auth redirect map in the V2 login page must include `school_sysadmin → /admin` alongside `school_admin`.
