/**
 * WCAG AA contrast gate for CORE v2 design-system tokens.
 *
 * Parses src/app/globals.css at runtime and resolves the full var() cascade
 * for each role/intensity pairing. This is the single source of truth — it
 * reads the actual file, so any future edit to globals.css that dims a color
 * is caught immediately without needing to update a parallel lookup table.
 *
 * Resolution order (last-wins, mirrors browser cascade specificity):
 *   1. :root { … }  (Tier-1 primitives + Tier-2 defaults)
 *   2. [data-role="ROLE"] { … }
 *   3. [data-role="ROLE"][data-intensity="INT"] { … }  (higher specificity)
 *
 * Checked pairs and thresholds:
 *   fg/bg             → ≥ 4.5 : 1   (body text, WCAG AA normal text)
 *   fg/surface        → ≥ 4.5 : 1   (body text on surface card)
 *   fg-muted/bg       → ≥ 4.5 : 1   (muted text, WCAG AA normal text)
 *   fg-on-brand/brand → ≥ 3.0 : 1   (large/bold UI text — button labels only,
 *                                     NOT body copy; WCAG 3:1 for large/UI components)
 *   brand/surface     → ≥ 3.0 : 1   (brand color on surface, large/UI)
 *
 * Run standalone: npx tsx scripts/a11y/contrast-check.ts
 * Run via npm:    npm run a11y
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Path resolution — works under `npx tsx` and under vitest
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  // Walk up from this file until we find package.json
  // __filename works with tsx; for ESM vitest we use import.meta.url
  let dir: string;
  try {
    // ESM: import.meta.url is available
    const metaUrl = (
      typeof (globalThis as unknown as { __importMeta?: { url?: string } }).__importMeta?.url === 'string'
        ? (globalThis as unknown as { __importMeta: { url: string } }).__importMeta.url
        : undefined
    );
    if (metaUrl) {
      dir = path.dirname(fileURLToPath(metaUrl));
    } else {
      // CJS / tsx
      dir = path.dirname(__filename);
    }
  } catch {
    dir = path.dirname(__filename);
  }

  // Walk up until we find package.json (repo root)
  let candidate = dir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  // Fallback: cwd
  return process.cwd();
}

function defaultCssPath(): string {
  return path.join(findRepoRoot(), 'src', 'app', 'globals.css');
}

// ---------------------------------------------------------------------------
// CSS property map type
// ---------------------------------------------------------------------------

type PropMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Parse globals.css → PropMap and role/intensity palette slot assignments
// ---------------------------------------------------------------------------

interface SlotAssignment {
  bg?: string;
  surface?: string;
  fg?: string;
  fgMuted?: string;
  brand?: string;
  fgOnBrand?: string;
  okSurface?: string;
  okFg?: string;
  warnSurface?: string;
  warnFg?: string;
  riskSurface?: string;
  riskFg?: string;
  brandSurface?: string;
  brandFg?: string;
}

interface ParsedCss {
  /** All custom properties from :root (Tier-1 primitives + Tier-2 defaults). */
  rootProps: PropMap;
  /**
   * Slot assignments per role and intensity.
   * roleSlots[role][''] = assignments from [data-role="role"] selector
   * roleSlots[role]['calm'] = merged from [data-role="role"][data-intensity="calm"]
   */
  roleSlots: Map<string, Map<string, SlotAssignment>>;
}

const SLOT_CSS_PROP: Record<keyof SlotAssignment, string> = {
  bg:           '--bg',
  surface:      '--surface',
  fg:           '--fg',
  fgMuted:      '--fg-muted',
  brand:        '--brand',
  fgOnBrand:    '--fg-on-brand',
  okSurface:    '--ok-surface',
  okFg:         '--ok-fg',
  warnSurface:  '--warn-surface',
  warnFg:       '--warn-fg',
  riskSurface:  '--risk-surface',
  riskFg:       '--risk-fg',
  brandSurface: '--brand-surface',
  brandFg:      '--brand-fg',
};

/**
 * Minimal CSS block parser. Strips comments, then matches selector blocks
 * and extracts custom property declarations.
 */
function parseCss(cssText: string): ParsedCss {
  // Remove block comments
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '');

  const rootProps: PropMap = new Map();
  // roleSlots: role → (intensity|'' → SlotAssignment)
  const roleSlots: Map<string, Map<string, SlotAssignment>> = new Map();

  // Match all selector { ... } blocks (non-greedy, handles nesting-free CSS)
  const blockRe = /([^{]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(stripped)) !== null) {
    const selector = m[1].trim();
    const body = m[2];

    // Extract all --prop: value; declarations from this block
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    const decls: Array<[string, string]> = [];
    while ((d = declRe.exec(body)) !== null) {
      decls.push([d[1].trim(), d[2].trim()]);
    }

    // The selector may be prefixed with @import rules when there is no blank
    // line separating them — check if it ends with ":root" (possibly with
    // surrounding whitespace), e.g. `@import "tailwindcss";\n\n\n:root`.
    if (/(?:^|[\s;])\s*:root\s*$/.test(selector)) {
      for (const [prop, val] of decls) {
        rootProps.set(prop, val);
      }
      continue;
    }

    // Match [data-role="ROLE"] — no intensity
    const roleOnlyRe = /^\[data-role="([^"]+)"\]$/;
    // Match [data-role="ROLE"][data-intensity="INT"]
    const roleIntRe = /^\[data-role="([^"]+)"\]\[data-intensity="([^"]+)"\]$/;

    const roleOnlyMatch = roleOnlyRe.exec(selector);
    const roleIntMatch = roleIntRe.exec(selector);

    if (roleOnlyMatch || roleIntMatch) {
      const role = (roleOnlyMatch ?? roleIntMatch)![1];
      const intensity = roleIntMatch ? roleIntMatch[2] : '';

      if (!roleSlots.has(role)) roleSlots.set(role, new Map());
      const byIntensity = roleSlots.get(role)!;
      if (!byIntensity.has(intensity)) byIntensity.set(intensity, {});
      const slots = byIntensity.get(intensity)!;

      for (const [prop, val] of decls) {
        for (const [slotKey, cssProp] of Object.entries(SLOT_CSS_PROP) as [keyof SlotAssignment, string][]) {
          if (prop === cssProp) {
            slots[slotKey] = val;
          }
        }
      }
    }
  }

  return { rootProps, roleSlots };
}

// ---------------------------------------------------------------------------
// var() resolution
// ---------------------------------------------------------------------------

const MAX_VAR_HOPS = 10;
const HEX3_RE = /^#[0-9a-fA-F]{3}$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

function isHex(val: string): boolean {
  return HEX3_RE.test(val) || HEX6_RE.test(val);
}

/**
 * Expand a 3-digit hex to 6-digit.
 */
function normalizeHex(hex: string): string {
  if (HEX3_RE.test(hex)) {
    const [, r, g, b] = hex.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex.toLowerCase();
}

/**
 * Resolve a CSS value (which may be `var(--x)` or a hex literal) to a
 * concrete hex string, consulting propMap for custom property lookups.
 * Throws if resolution fails, naming the role and slot for clarity.
 */
function resolveToHex(
  value: string,
  propMap: PropMap,
  contextLabel: string,
): string {
  let current = value.trim();
  for (let hop = 0; hop < MAX_VAR_HOPS; hop++) {
    if (isHex(current)) return normalizeHex(current);

    // Handle var(--prop) or var(--prop, fallback) — only follow the main reference
    const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,.*?)?\)$/.exec(current);
    if (!varMatch) {
      throw new Error(
        `[contrast-check] Cannot resolve "${current}" to hex for ${contextLabel}. ` +
        `Expected a #hex literal or var(--prop).`
      );
    }
    const prop = varMatch[1];
    const next = propMap.get(prop);
    if (next === undefined) {
      throw new Error(
        `[contrast-check] Custom property "${prop}" not found in propMap ` +
        `while resolving "${value}" for ${contextLabel}.`
      );
    }
    current = next.trim();
  }
  throw new Error(
    `[contrast-check] var() chain exceeded ${MAX_VAR_HOPS} hops resolving "${value}" for ${contextLabel}.`
  );
}

// ---------------------------------------------------------------------------
// WCAG relative luminance + contrast ratio (WCAG 2.1 §1.4.3)
// ---------------------------------------------------------------------------

export interface ContrastResult {
  role: string;
  intensity: string;
  pair: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  passes: boolean;
}

function hexToSrgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function linearize(c8bit: number): number {
  const c = c8bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToSrgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Palette type
// ---------------------------------------------------------------------------

interface Palette {
  bg: string;
  surface: string;
  fg: string;
  fgMuted: string;
  brand: string;
  fgOnBrand: string;
  okSurface: string;
  okFg: string;
  warnSurface: string;
  warnFg: string;
  riskSurface: string;
  riskFg: string;
  brandSurface: string;
  brandFg: string;
}

// ---------------------------------------------------------------------------
// Pair definitions: [label, fgKey, bgKey, requiredRatio]
// ---------------------------------------------------------------------------
type PairDef = [string, keyof Palette, keyof Palette, number];

const PAIRS: PairDef[] = [
  ['fg/bg',             'fg',        'bg',      4.5],
  ['fg/surface',        'fg',        'surface', 4.5],
  ['fg-muted/bg',       'fgMuted',   'bg',      4.5],
  // fg-on-brand is for large/bold UI text (button labels) ONLY, not body copy.
  // WCAG 3:1 threshold applies for large text (≥18pt or ≥14pt bold) and UI components.
  ['fg-on-brand/brand', 'fgOnBrand', 'brand',   3.0],
  ['brand/surface',     'brand',     'surface', 3.0],
  // Signal-pair tokens: tinted surface + fg for WCAG AA-readable badge pills (RiskBadge).
  // Normal text (14px) → 4.5:1 threshold applies.
  ['ok-fg/ok-surface',     'okFg',        'okSurface',   4.5],
  ['warn-fg/warn-surface', 'warnFg',      'warnSurface', 4.5],
  ['risk-fg/risk-surface', 'riskFg',      'riskSurface', 4.5],
  // Brand-pill pair: tinted brand surface + dark brand fg for CLBadge "Enrich" pill.
  // Normal text (14px, text-sm) → 4.5:1 threshold applies (WCAG AA).
  ['brand-fg/brand-surface', 'brandFg', 'brandSurface', 4.5],
];

// Sidebar (teacher rail) pairs — resolved from :root (not role/intensity-scoped).
// [label, fgProp, bgProp, requiredRatio]
const SIDEBAR_PAIRS: Array<[string, string, string, number]> = [
  ['sidebar-fg/sidebar',               '--sidebar-fg',        '--sidebar',        4.5],
  ['sidebar-fg-muted/sidebar',         '--sidebar-fg-muted',  '--sidebar',        4.5],
  ['sidebar-active-fg/sidebar-active', '--sidebar-active-fg', '--sidebar-active', 4.5],
  ['signout/sidebar-danger',           '--white',             '--sidebar-danger', 4.5],
];

// ---------------------------------------------------------------------------
// Build resolved palettes from parsed CSS
// ---------------------------------------------------------------------------

function buildPalettes(
  parsed: ParsedCss,
): Map<string, Map<string, Palette>> {
  const { rootProps, roleSlots } = parsed;

  // Merge rootProps into a single flat prop map for resolution.
  // We also inline any Tier-2 defaults from :root so that roles that
  // don't override a slot fall back to the :root value.
  const flatProps: PropMap = new Map(rootProps);

  const result: Map<string, Map<string, Palette>> = new Map();

  for (const [role, intensityMap] of roleSlots) {
    const byIntensity: Map<string, Palette> = new Map();

    // Collect the role-only slot overrides (key = '' entry)
    const roleBaseSlots = intensityMap.get('') ?? {};

    // Each intensity gets its own merged view
    for (const [intensity, intensitySlots] of intensityMap) {
      // We only emit palettes for non-empty intensity keys (the actual intensity
      // selectors), plus the '' (role-only) case if no intensity exists.
      // But because the spec says to emit per discovered intensity, we emit
      // for the '' key only if there are no intensity keys at all for this role.
      if (intensity === '' && intensityMap.size > 1) continue;

      // Merge: start from role-only slots, overlay intensity-specific slots
      const mergedSlots: SlotAssignment = { ...roleBaseSlots, ...intensitySlots };

      // Build propMap for this role+intensity: root + role overrides + intensity overrides
      // We need to resolve tokens in the context of all declarations merged.
      // Build an overlay propMap so var() resolution follows correct order.
      const overlayProps: PropMap = new Map(flatProps);

      // Apply role-only overrides
      const roleBlock = intensityMap.get('');
      if (roleBlock) {
        for (const [slotKey, cssProp] of Object.entries(SLOT_CSS_PROP) as [keyof SlotAssignment, string][]) {
          const val = roleBlock[slotKey];
          if (val !== undefined) overlayProps.set(cssProp, val);
        }
      }
      // Apply intensity-specific overrides
      if (intensity !== '') {
        for (const [slotKey, cssProp] of Object.entries(SLOT_CSS_PROP) as [keyof SlotAssignment, string][]) {
          const val = intensitySlots[slotKey];
          if (val !== undefined) overlayProps.set(cssProp, val);
        }
      }

      // Resolve each slot
      const ctx = `${role}/${intensity || 'base'}`;
      const resolveSlot = (slotKey: keyof SlotAssignment): string => {
        // Get the final value for this slot from the merged overlay
        const cssProp = SLOT_CSS_PROP[slotKey];
        const slotVal = mergedSlots[slotKey] ?? overlayProps.get(cssProp);
        if (slotVal === undefined) {
          throw new Error(
            `[contrast-check] Slot "${slotKey}" (${cssProp}) not defined for ${ctx}.`
          );
        }
        return resolveToHex(slotVal, overlayProps, `${ctx} slot="${slotKey}"`);
      };

      const palette: Palette = {
        bg:           resolveSlot('bg'),
        surface:      resolveSlot('surface'),
        fg:           resolveSlot('fg'),
        fgMuted:      resolveSlot('fgMuted'),
        brand:        resolveSlot('brand'),
        fgOnBrand:    resolveSlot('fgOnBrand'),
        okSurface:    resolveSlot('okSurface'),
        okFg:         resolveSlot('okFg'),
        warnSurface:  resolveSlot('warnSurface'),
        warnFg:       resolveSlot('warnFg'),
        riskSurface:  resolveSlot('riskSurface'),
        riskFg:       resolveSlot('riskFg'),
        brandSurface: resolveSlot('brandSurface'),
        brandFg:      resolveSlot('brandFg'),
      };

      const intensityKey = intensity === '' ? 'base' : intensity;
      byIntensity.set(intensityKey, palette);
    }

    result.set(role, byIntensity);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API: checkAllPairs
// ---------------------------------------------------------------------------

/**
 * Parse globals.css (or the provided cssText/path), resolve all var() chains,
 * and run every PAIRS check across all discovered role/intensity combinations.
 *
 * @param cssSource  Optional: a CSS string (if it contains newlines) or an
 *                   absolute file path to use instead of the default globals.css.
 */
export function checkAllPairs(cssSource?: string): ContrastResult[] {
  let cssText: string;

  if (cssSource !== undefined) {
    // If it looks like actual CSS content (contains newlines or braces), use as-is.
    // Otherwise treat as a file path.
    if (cssSource.includes('\n') || cssSource.includes('{')) {
      cssText = cssSource;
    } else {
      cssText = fs.readFileSync(cssSource, 'utf8');
    }
  } else {
    const cssPath = defaultCssPath();
    cssText = fs.readFileSync(cssPath, 'utf8');
  }

  const parsed = parseCss(cssText);
  const palettes = buildPalettes(parsed);

  const results: ContrastResult[] = [];

  for (const [role, intensityMap] of palettes) {
    for (const [intensity, palette] of intensityMap) {
      for (const [pairLabel, fgKey, bgKey, required] of PAIRS) {
        const fg = palette[fgKey];
        const bg = palette[bgKey];
        const ratio = contrastRatio(fg, bg);
        results.push({
          role,
          intensity,
          pair: pairLabel,
          fg,
          bg,
          ratio,
          required,
          passes: ratio >= required,
        });
      }
    }
  }

  // Sidebar pairs (single palette, resolved from :root) — only when the tokens
  // are defined (synthetic fixture CSS in tests omits them).
  if (parsed.rootProps.has('--sidebar')) {
    for (const [pairLabel, fgProp, bgProp, required] of SIDEBAR_PAIRS) {
      const fg = resolveToHex(`var(${fgProp})`, parsed.rootProps, `sidebar slot="${fgProp}"`);
      const bg = resolveToHex(`var(${bgProp})`, parsed.rootProps, `sidebar slot="${bgProp}"`);
      const ratio = contrastRatio(fg, bg);
      results.push({ role: 'sidebar', intensity: 'base', pair: pairLabel, fg, bg, ratio, required, passes: ratio >= required });
    }
  }

  return results;
}

// Also export for tests that want to inspect internals
export { parseCss, buildPalettes, resolveToHex };
export type { ParsedCss, Palette };

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/a11y/contrast-check.ts')) {
  const results = checkAllPairs();
  const failures = results.filter((r) => !r.passes);
  const total = results.length;
  const passed = total - failures.length;

  console.log(`\nCORE v2 — WCAG AA contrast check`);
  console.log(`${'─'.repeat(60)}`);

  for (const r of results) {
    const icon = r.passes ? '✓' : '✗';
    const status = r.passes ? 'PASS' : 'FAIL';
    console.log(
      `${icon} [${status}]  ${r.role}/${r.intensity}  ${r.pair.padEnd(22)}` +
      `  ratio=${r.ratio.toFixed(2).padStart(5)}  req≥${r.required}`
    );
  }

  console.log(`${'─'.repeat(60)}`);
  console.log(`${passed}/${total} pairs passed.\n`);

  if (failures.length > 0) {
    console.error(`ERROR: ${failures.length} contrast failure(s). Fix globals.css tokens.\n`);
    process.exit(1);
  } else {
    console.log(`All pairs meet WCAG AA. ✓\n`);
    process.exit(0);
  }
}
