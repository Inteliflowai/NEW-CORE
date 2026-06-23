// scripts/design/generate-tokens-css.ts
// Generates the CSS token layer (Tier 1/2/3 + @theme) from the single source of
// truth src/lib/design/tokens.ts, and writes it into the GENERATED region of
// src/app/globals.css (between the BEGIN/END markers).
//
//   npm run tokens:gen     → regenerate the region in globals.css
//   npm run tokens:check   → fail (exit 1) if globals.css is out of sync (CI guard)
//
// The look is preserved by construction: values are emitted verbatim from tokens.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ramps, oneOffs, semanticDefaults, roleBindings, intensityBindings, theme,
} from '../../src/lib/design/tokens';

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBALS = resolve(HERE, '../../src/app/globals.css');
const BEGIN = '/* TOKENS:GENERATED:BEGIN — do not edit; source: src/lib/design/tokens.ts · run `npm run tokens:gen` */';
const END = '/* TOKENS:GENERATED:END */';

const decl = (name: string, value: string) => `  --${name}: ${value};`;

function buildRegion(): string {
  const lines: string[] = [];

  // ── Tier 1 + Tier 2 (one :root) ──
  lines.push(':root {');
  lines.push('  /* Tier 1 — primitive ramps (the only hex) */');
  for (const [ramp, stops] of Object.entries(ramps)) {
    for (const [stop, hex] of Object.entries(stops)) lines.push(decl(`${ramp}-${stop}`, hex));
  }
  lines.push('  /* Tier 1 — one-offs */');
  for (const [name, hex] of Object.entries(oneOffs)) lines.push(decl(name, hex));
  lines.push('  /* Tier 2 — semantic slots (light / teacher-calm baseline) */');
  for (const [name, value] of Object.entries(semanticDefaults)) lines.push(decl(name, value));
  lines.push('}');

  // ── Tier 3 — role bindings ──
  for (const [role, vars] of Object.entries(roleBindings)) {
    lines.push('');
    lines.push(`[data-role="${role}"] {`);
    for (const [name, value] of Object.entries(vars)) lines.push(decl(name, value));
    lines.push('}');
  }

  // ── Tier 3 — role × intensity bindings ──
  for (const { role, intensity, vars } of intensityBindings) {
    lines.push('');
    lines.push(`[data-role="${role}"][data-intensity="${intensity}"] {`);
    for (const [name, value] of Object.entries(vars)) lines.push(decl(name, value));
    lines.push('}');
  }

  // ── @theme inline — expose Tier-2 slots as Tailwind v4 tokens ──
  lines.push('');
  lines.push('@theme inline {');
  for (const name of theme.colors) lines.push(decl(`color-${name}`, `var(--${name})`));
  for (const [key, value] of Object.entries(theme.radius)) lines.push(decl(`radius-${key}`, value));
  for (const [key, value] of Object.entries(theme.shadow)) lines.push(decl(`shadow-${key}`, value));
  lines.push(decl('font-display', theme.fonts.display));
  lines.push(decl('font-sans', theme.fonts.sans));
  lines.push('}');

  return lines.join('\n');
}

/** Replace the marked region in globals.css with `region`. Returns the new file text. */
function spliceRegion(css: string, region: string): string {
  const b = css.indexOf(BEGIN);
  const e = css.indexOf(END);
  if (b === -1 || e === -1 || e < b) {
    throw new Error('globals.css is missing the TOKENS:GENERATED markers. Add the BEGIN/END markers first.');
  }
  return css.slice(0, b) + BEGIN + '\n' + region + '\n' + END + css.slice(e + END.length);
}

function main() {
  const check = process.argv.includes('--check');
  const css = readFileSync(GLOBALS, 'utf8');
  const next = spliceRegion(css, buildRegion());

  if (check) {
    if (next !== css) {
      console.error('✗ globals.css is OUT OF SYNC with src/lib/design/tokens.ts. Run `npm run tokens:gen`.');
      process.exit(1);
    }
    console.log('✓ globals.css token region is in sync with tokens.ts');
    return;
  }

  if (next === css) { console.log('✓ globals.css already up to date'); return; }
  writeFileSync(GLOBALS, next, 'utf8');
  console.log('✓ regenerated the token region in src/app/globals.css from tokens.ts');
}

main();
