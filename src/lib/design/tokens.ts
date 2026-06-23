// src/lib/design/tokens.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE SOURCE OF TRUTH for CORE V2 design tokens (Marvin, 2026-06-22 — "B").
//
// This TS module is canonical. The CSS in src/app/globals.css (the GENERATED
// region between the BEGIN/END markers) is PRODUCED FROM THIS FILE by
// `npm run tokens:gen` (scripts/design/generate-tokens-css.ts). Never hand-edit
// the generated region — edit here and regenerate. `npm run tokens:check` fails
// if the two drift.
//
// Colour values are stored exactly as the CSS used them so the generated output
// is byte-for-byte equivalent to the previously hand-written globals.css:
//   • ramps  → raw hex (JS-resolvable)
//   • Tier-2 / Tier-3 slots → `var(--ramp-key)` strings (role-resolved at runtime
//     by the CSS cascade — these are CSS-only by nature; JS cannot statically
//     resolve a role-dependent slot, so a var() string is the honest form)
//   • motion → real JS values (numbers / cubic-bezier arrays / spring configs)
//     consumed DIRECTLY by framer-motion (no CSS-var bridge).
//
// Token CLASS NAMES (text-fg, bg-brand, shadow-pop, …) are unchanged, so no
// component is touched and the look is preserved.
// ─────────────────────────────────────────────────────────────────────────────

/** Tier 1 — primitive colour ramps. The ONLY place raw hex lives. */
export const ramps = {
  emerald: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22' },
  lime:    { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d', 700: '#4d7c0f', 800: '#3f6212', 900: '#365314', 950: '#1a2e05' },
  cobalt:  { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a', 950: '#172554' },
  coral:   { 50: '#fff1ee', 100: '#ffe0d9', 200: '#ffc5b8', 300: '#ff9d87', 400: '#f97055', 500: '#e0533f', 600: '#c93d29', 700: '#a72d1d', 800: '#8a271a', 900: '#72261c', 950: '#3e0f09' },
  amber:   { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03' },
  ink:     { 50: '#f8f8f8', 100: '#f0f0f0', 200: '#e4e4e4', 300: '#d1d1d1', 400: '#a8a8a8', 500: '#737373', 600: '#525252', 700: '#3d3d3d', 800: '#262626', 900: '#171717', 950: '#0a0a0a' },
} as const;

/** Tier-1 one-offs (not part of a ramp). Referenced via var() outside :root. */
export const oneOffs: Record<string, string> = {
  'canvas-admin': '#14132b',
  'canvas-platform': '#18181b',
  white: '#ffffff',
  'surface-admin': '#1e1d3a',
  'surface-platform': '#27272a',
};

/**
 * Tier 2 — semantic slots (default = light / teacher-calm baseline).
 * Components reference ONLY these (via the Tailwind utilities @theme exposes).
 * Values are CSS-ready strings (var() refs or literals) — verbatim from globals.css.
 */
export const semanticDefaults: Record<string, string> = {
  bg: 'var(--ink-50)',
  surface: '#ffffff',
  fg: 'var(--ink-900)',
  'fg-muted': 'var(--ink-600)',
  brand: 'var(--cobalt-600)',
  'brand-accent': 'var(--cobalt-400)',
  'fg-on-brand': 'var(--white)',
  ok: 'var(--emerald-600)',
  warn: 'var(--amber-500)',
  risk: 'var(--coral-500)',
  'ok-surface': 'var(--emerald-50)',
  'ok-fg': 'var(--emerald-800)',
  'warn-surface': 'var(--amber-50)',
  'warn-fg': 'var(--amber-900)',
  'risk-surface': 'var(--coral-50)',
  'risk-fg': 'var(--coral-900)',
  'brand-surface': 'var(--cobalt-50)',
  'brand-fg': 'var(--cobalt-800)',
  radius: '0.5rem',
  'radius-lg': '1rem',
  shadow: '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
  'shadow-pop': '0 8px 24px -4px rgb(0 0 0 / 0.16), 0 4px 8px -2px rgb(0 0 0 / 0.10)',
  // Sidebar (teacher pop-art rail)
  sidebar: 'var(--cobalt-700)',
  'sidebar-fg': 'var(--white)',
  'sidebar-fg-muted': 'var(--cobalt-100)',
  'sidebar-active': 'var(--lime-400)',
  'sidebar-active-fg': 'var(--ink-950)',
  'sidebar-edge': 'var(--ink-950)',
  'sidebar-plate': 'var(--white)',
  'sidebar-danger': 'var(--coral-600)',
};

/**
 * Tier 3 — role bindings. Each role rebinds a subset of Tier-2 slots.
 * Emitted as `[data-role="<key>"] { … }`. Verbatim from globals.css.
 */
export const roleBindings: Record<string, Record<string, string>> = {
  student: {
    brand: 'var(--emerald-600)', 'brand-accent': 'var(--lime-500)', 'fg-on-brand': 'var(--white)',
    ok: 'var(--emerald-600)', bg: 'var(--ink-50)', surface: 'var(--white)', fg: 'var(--ink-900)',
    'fg-muted': 'var(--ink-600)', 'brand-surface': 'var(--emerald-50)', 'brand-fg': 'var(--emerald-800)',
  },
  teacher: {
    brand: 'var(--cobalt-600)', 'brand-accent': 'var(--cobalt-400)', 'fg-on-brand': 'var(--white)',
    ok: 'var(--emerald-600)', bg: 'var(--ink-50)', surface: 'var(--white)', fg: 'var(--ink-900)',
    'fg-muted': 'var(--ink-600)', 'brand-surface': 'var(--cobalt-50)', 'brand-fg': 'var(--cobalt-800)',
  },
  parent: {
    brand: 'var(--coral-500)', 'brand-accent': 'var(--coral-300)', 'fg-on-brand': 'var(--white)',
    ok: 'var(--emerald-600)', bg: 'var(--ink-50)', surface: 'var(--white)', fg: 'var(--ink-900)',
    'fg-muted': 'var(--ink-600)', 'brand-surface': 'var(--coral-50)', 'brand-fg': 'var(--coral-900)',
  },
  admin: {
    bg: 'var(--canvas-admin)', surface: 'var(--surface-admin)', fg: 'var(--ink-100)', 'fg-muted': 'var(--ink-400)',
    brand: 'var(--cobalt-400)', 'brand-accent': 'var(--cobalt-300)', 'fg-on-brand': 'var(--ink-950)',
    ok: 'var(--emerald-400)', warn: 'var(--amber-400)', risk: 'var(--coral-400)',
    'ok-surface': 'var(--emerald-950)', 'ok-fg': 'var(--emerald-300)', 'warn-surface': 'var(--amber-950)',
    'warn-fg': 'var(--amber-300)', 'risk-surface': 'var(--coral-950)', 'risk-fg': 'var(--coral-300)',
    'brand-surface': 'var(--cobalt-950)', 'brand-fg': 'var(--cobalt-300)',
  },
  'super-admin': {
    bg: 'var(--canvas-platform)', surface: 'var(--surface-platform)', fg: 'var(--ink-100)', 'fg-muted': 'var(--ink-400)',
    brand: 'var(--amber-500)', 'brand-accent': 'var(--amber-300)', 'fg-on-brand': 'var(--ink-950)',
    ok: 'var(--emerald-400)', warn: 'var(--amber-400)', risk: 'var(--coral-400)',
    'ok-surface': 'var(--emerald-950)', 'ok-fg': 'var(--emerald-300)', 'warn-surface': 'var(--amber-950)',
    'warn-fg': 'var(--amber-300)', 'risk-surface': 'var(--coral-950)', 'risk-fg': 'var(--coral-300)',
    'brand-surface': 'var(--amber-950)', 'brand-fg': 'var(--amber-300)',
  },
};

/**
 * Tier 3 — role × intensity bindings (radius + shadow). Emitted as
 * `[data-role="<role>"][data-intensity="<intensity>"] { … }`. Verbatim.
 */
export const intensityBindings: { role: string; intensity: string; vars: Record<string, string> }[] = [
  { role: 'student', intensity: 'loud', vars: {
    radius: '0.75rem', 'radius-lg': '1.25rem',
    shadow: '0 2px 6px 0 rgb(5 150 105 / 0.12)',
    'shadow-pop': '0 10px 28px -4px rgb(5 150 105 / 0.22), 0 4px 10px -2px rgb(5 150 105 / 0.14)',
  } },
  { role: 'teacher', intensity: 'calm', vars: {
    radius: '0.5rem', 'radius-lg': '0.875rem',
    shadow: '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
    'shadow-pop': '0 6px 16px -3px rgb(37 99 235 / 0.12), 0 3px 6px -2px rgb(0 0 0 / 0.08)',
  } },
  { role: 'parent', intensity: 'calm', vars: {
    radius: '0.5rem', 'radius-lg': '0.875rem',
    shadow: '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
    'shadow-pop': '0 6px 16px -3px rgb(224 83 63 / 0.12), 0 3px 6px -2px rgb(0 0 0 / 0.08)',
  } },
  { role: 'admin', intensity: 'calm', vars: {
    radius: '0.5rem', 'radius-lg': '0.75rem',
    shadow: '0 1px 4px 0 rgb(0 0 0 / 0.40)',
    'shadow-pop': '0 6px 20px -4px rgb(0 0 0 / 0.50)',
  } },
  { role: 'super-admin', intensity: 'calm', vars: {
    radius: '0.375rem', 'radius-lg': '0.625rem',
    shadow: '0 1px 4px 0 rgb(0 0 0 / 0.50)',
    'shadow-pop': '0 6px 20px -4px rgb(0 0 0 / 0.60)',
  } },
];

/**
 * @theme exposure — which Tier-2 slots become Tailwind v4 design tokens, and the
 * radius/shadow/font tokens. Drives the `@theme inline { … }` block.
 * `colors` lists the slot names exposed as `--color-<name>` (→ bg-/text-/border- utilities).
 */
export const theme = {
  colors: [
    'bg', 'surface', 'fg', 'fg-muted', 'brand', 'brand-accent', 'fg-on-brand',
    'brand-surface', 'brand-fg', 'ok', 'warn', 'risk', 'ok-surface', 'ok-fg',
    'warn-surface', 'warn-fg', 'risk-surface', 'risk-fg',
    'sidebar', 'sidebar-fg', 'sidebar-fg-muted', 'sidebar-active', 'sidebar-active-fg',
    'sidebar-edge', 'sidebar-plate', 'sidebar-danger',
  ],
  radius: { DEFAULT: 'var(--radius)', lg: 'var(--radius-lg)' },
  shadow: {
    DEFAULT: 'var(--shadow)',
    pop: 'var(--shadow-pop)',
    sticker: '3px 3px 0 var(--sidebar-edge)',
    'sticker-lg': '6px 6px 0 var(--sidebar-edge)',
  },
  fonts: { display: 'var(--font-bricolage)', sans: 'var(--font-inter)' },
} as const;

/**
 * MOTION TOKENS — NEW. Consumed DIRECTLY by framer-motion (JS), per the
 * signature-moment prototype (durations in seconds, cubic-bezier arrays, springs).
 * The coach "arrives" (gentle ease-out) and a touch of spring in the student register.
 * DRAFT values → tuned during the signature-moment prototype; FEEL-DIRECTION.md will own them.
 */
export type Cubic = [number, number, number, number];
export type Spring = { type: 'spring'; stiffness: number; damping: number };
export const motion: {
  duration: { instant: number; fast: number; base: number; slow: number; ambient: number };
  ease: { out: Cubic; inOut: Cubic; standard: Cubic; exit: Cubic };
  spring: { calm: Spring; playful: Spring; spark: Spring };
} = {
  /** seconds */
  duration: { instant: 0, fast: 0.18, base: 0.28, slow: 0.45, ambient: 0.9 },
  /** cubic-bezier control points [x1,y1,x2,y2] (mutable tuples — framer-motion Easing) */
  ease: {
    out: [0.16, 1, 0.3, 1],   // soft "settle in"
    inOut: [0.65, 0, 0.35, 1],
    standard: [0.4, 0, 0.2, 1],
    exit: [0.4, 0, 1, 1],      // accelerate away — the DEFER ease
  },
  /** framer-motion spring configs */
  spring: {
    calm: { type: 'spring', stiffness: 200, damping: 30 },     // teacher/parent — no bounce
    playful: { type: 'spring', stiffness: 380, damping: 22 },  // student — a touch of bounce
    spark: { type: 'spring', stiffness: 500, damping: 16 },    // earned celebratory pop
  },
};

export type Ramp = keyof typeof ramps;
export type SemanticSlot = keyof typeof semanticDefaults;
