/**
 * WCAG AA contrast gate for CORE v2 design-system tokens.
 *
 * Hardcodes the resolved hex values for every Tier-2 fg/bg pairing across
 * all 5 roles × their intensity. When globals.css primitive hex changes, update
 * the ROLE_PALETTES table below in sync.
 *
 * Requirements:
 *   body text  (pair: 'fg/bg')           → ≥ 4.5 : 1
 *   fg on surface (pair: 'fg/surface')   → ≥ 4.5 : 1
 *   muted text (pair: 'fg-muted/bg')     → ≥ 4.5 : 1  (AA for normal text)
 *   fg-on-brand (pair: 'fg-on-brand/brand') → ≥ 4.5 : 1
 *   brand on surface (pair: 'brand/surface') → ≥ 3 : 1  (large/UI text)
 *
 * SYNC WITH: src/app/globals.css  (Tier-1 ramp values + Tier-3 role bindings)
 *
 * Run standalone: npx tsx scripts/a11y/contrast-check.ts
 * Run via npm:    npm run a11y
 */

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

// ---------------------------------------------------------------------------
// WCAG relative luminance + contrast ratio (WCAG 2.1 §1.4.3)
// ---------------------------------------------------------------------------

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
// Token table — resolved hex per role / intensity
// SYNC WITH: src/app/globals.css  (Tier-1 ramp values + Tier-3 bindings)
// ---------------------------------------------------------------------------

interface Palette {
  bg: string;
  surface: string;
  fg: string;
  fgMuted: string;
  brand: string;
  fgOnBrand: string;
}

// Tier-1 resolved values (must match globals.css :root hex)
const T = {
  // Emerald
  emerald600: '#059669',
  // Lime
  lime500:    '#84cc16',
  // Cobalt
  cobalt600:  '#2563eb',
  cobalt400:  '#60a5fa',
  // Coral
  coral500:   '#e0533f',
  coral300:   '#ff9d87',
  // Amber
  amber500:   '#f59e0b',
  amber300:   '#fcd34d',
  // Ink
  ink50:      '#f8f8f8',
  ink100:     '#f0f0f0',
  ink400:     '#a8a8a8',
  ink600:     '#525252',
  ink900:     '#171717',
  ink950:     '#0a0a0a',
  // Dark canvases
  canvasAdmin:     '#14132b',
  canvasPlatform:  '#18181b',
  surfaceAdmin:    '#1e1d3a',
  surfacePlatform: '#27272a',
  white:           '#ffffff',
} as const;

const ROLE_PALETTES: Record<string, Record<string, Palette>> = {
  student: {
    loud: {
      bg:        T.ink50,
      surface:   T.white,
      fg:        T.ink900,
      fgMuted:   T.ink600,
      brand:     T.emerald600,
      fgOnBrand: T.white,
    },
  },
  teacher: {
    calm: {
      bg:        T.ink50,
      surface:   T.white,
      fg:        T.ink900,
      fgMuted:   T.ink600,
      brand:     T.cobalt600,
      fgOnBrand: T.white,
    },
  },
  parent: {
    calm: {
      bg:        T.ink50,
      surface:   T.white,
      fg:        T.ink900,
      fgMuted:   T.ink600,
      brand:     T.coral500,
      fgOnBrand: T.white,
    },
  },
  admin: {
    calm: {
      bg:        T.canvasAdmin,
      surface:   T.surfaceAdmin,
      fg:        T.ink100,
      fgMuted:   T.ink400,
      brand:     T.cobalt400,
      fgOnBrand: T.ink950,
    },
  },
  'super-admin': {
    calm: {
      bg:        T.canvasPlatform,
      surface:   T.surfacePlatform,
      fg:        T.ink100,
      fgMuted:   T.ink400,
      brand:     T.amber500,
      fgOnBrand: T.ink950,
    },
  },
};

// ---------------------------------------------------------------------------
// Pair definitions: [label, fgKey, bgKey, requiredRatio]
// ---------------------------------------------------------------------------
type PairDef = [string, keyof Palette, keyof Palette, number];

const PAIRS: PairDef[] = [
  ['fg/bg',             'fg',        'bg',      4.5],
  ['fg/surface',        'fg',        'surface', 4.5],
  ['fg-muted/bg',       'fgMuted',   'bg',      4.5],
  ['fg-on-brand/brand', 'fgOnBrand', 'brand',   3.0],
  ['brand/surface',     'brand',     'surface', 3.0],
];

export function checkAllPairs(): ContrastResult[] {
  const results: ContrastResult[] = [];

  for (const [role, intensities] of Object.entries(ROLE_PALETTES)) {
    for (const [intensity, palette] of Object.entries(intensities)) {
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

  return results;
}

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
    console.error(`ERROR: ${failures.length} contrast failure(s). Fix globals.css or this token table.\n`);
    process.exit(1);
  } else {
    console.log(`All pairs meet WCAG AA. ✓\n`);
    process.exit(0);
  }
}
