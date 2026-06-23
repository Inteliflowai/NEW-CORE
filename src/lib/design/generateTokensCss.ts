// Pure generator for the CSS token layer — imported by both the CLI script
// (scripts/design/generate-tokens-css.ts) and the contract test. No fs/process
// here so importing it has no side effects (the test can assert against it).
import { ramps, oneOffs, semanticDefaults, roleBindings, intensityBindings, theme } from './tokens';

export const TOKENS_BEGIN = '/* TOKENS:GENERATED:BEGIN — do not edit; source: src/lib/design/tokens.ts · run `npm run tokens:gen` */';
export const TOKENS_END = '/* TOKENS:GENERATED:END */';

/** Normalize CRLF → LF so all comparisons/splices are line-ending-agnostic
 *  (the repo uses core.autocrlf; a CRLF checkout must not read as drift). */
export const lf = (s: string): string => s.replace(/\r\n/g, '\n');

const decl = (name: string, value: string) => `  --${name}: ${value};`;

/** Build the GENERATED CSS region (Tier 1/2 :root + Tier 3 selectors + @theme). LF. */
export function buildTokenRegion(): string {
  const lines: string[] = [];

  lines.push(':root {');
  lines.push('  /* Tier 1 — primitive ramps (the only hex) */');
  for (const [ramp, stops] of Object.entries(ramps))
    for (const [stop, hex] of Object.entries(stops)) lines.push(decl(`${ramp}-${stop}`, hex));
  lines.push('  /* Tier 1 — one-offs */');
  for (const [name, hex] of Object.entries(oneOffs)) lines.push(decl(name, hex));
  lines.push('  /* Tier 2 — semantic slots (light / teacher-calm baseline) */');
  for (const [name, value] of Object.entries(semanticDefaults)) lines.push(decl(name, value));
  lines.push('}');

  for (const [role, vars] of Object.entries(roleBindings)) {
    lines.push('');
    lines.push(`[data-role="${role}"] {`);
    for (const [name, value] of Object.entries(vars)) lines.push(decl(name, value));
    lines.push('}');
  }

  for (const { role, intensity, vars } of intensityBindings) {
    lines.push('');
    lines.push(`[data-role="${role}"][data-intensity="${intensity}"] {`);
    for (const [name, value] of Object.entries(vars)) lines.push(decl(name, value));
    lines.push('}');
  }

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

/** Replace the marked region in `css` with `region`. Output is LF-normalized. */
export function spliceRegion(css: string, region: string): string {
  const src = lf(css);
  const b = src.indexOf(TOKENS_BEGIN);
  const e = src.indexOf(TOKENS_END);
  if (b === -1 || e === -1 || e < b) {
    throw new Error('globals.css is missing the TOKENS:GENERATED markers.');
  }
  return src.slice(0, b) + TOKENS_BEGIN + '\n' + region + '\n' + TOKENS_END + src.slice(e + TOKENS_END.length);
}

/** Extract the current generated region text (between markers, trim framing newlines). */
export function extractRegion(css: string): string {
  const src = lf(css);
  const b = src.indexOf(TOKENS_BEGIN);
  const e = src.indexOf(TOKENS_END);
  if (b === -1 || e === -1 || e < b) throw new Error('globals.css is missing the TOKENS:GENERATED markers.');
  return src.slice(b + TOKENS_BEGIN.length, e).replace(/^\n/, '').replace(/\n$/, '');
}
