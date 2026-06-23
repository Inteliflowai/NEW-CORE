// scripts/design/generate-tokens-css.ts
// Writes the generated token layer into src/app/globals.css from the SoT
// (src/lib/design/tokens.ts). Pure logic lives in src/lib/design/generateTokensCss.ts.
//
//   npm run tokens:gen     → regenerate the region in globals.css
//   npm run tokens:check   → fail (exit 1) if globals.css is out of sync (CI guard)
//
// Comparison is LF-normalized so a CRLF (Windows/autocrlf) checkout never reads as
// false drift. The look is preserved by construction (values emitted verbatim).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTokenRegion, spliceRegion, lf } from '../../src/lib/design/generateTokensCss';

const GLOBALS = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/globals.css');

function main() {
  const check = process.argv.includes('--check');
  const css = readFileSync(GLOBALS, 'utf8');
  const next = spliceRegion(css, buildTokenRegion()); // LF
  const current = lf(css);                            // LF-normalized for an apples-to-apples compare

  if (check) {
    if (next !== current) {
      console.error('✗ globals.css is OUT OF SYNC with src/lib/design/tokens.ts. Run `npm run tokens:gen`.');
      process.exit(1);
    }
    console.log('✓ globals.css token region is in sync with tokens.ts');
    return;
  }

  if (next === current) { console.log('✓ globals.css already up to date'); return; }
  writeFileSync(GLOBALS, next, 'utf8'); // writes LF
  console.log('✓ regenerated the token region in src/app/globals.css from tokens.ts');
}

main();
