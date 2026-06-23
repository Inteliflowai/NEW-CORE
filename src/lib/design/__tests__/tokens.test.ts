// Locks the contract that src/app/globals.css faithfully reflects the single
// source of truth src/lib/design/tokens.ts. Fails if tokens.ts changed without
// `npm run tokens:gen` (drift), or if the generated region was hand-edited.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ramps, oneOffs, semanticDefaults, roleBindings, intensityBindings, theme, motion } from '@/lib/design/tokens';
import { buildTokenRegion, extractRegion, lf } from '@/lib/design/generateTokensCss';

const css = lf(readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8'));
const region = extractRegion(css);

describe('globals.css reflects tokens.ts (the SoT)', () => {
  it('byte-equals the generated region (true drift lock, line-ending agnostic)', () => {
    expect(region).toBe(buildTokenRegion());
  });

  it('emits every Tier-1 ramp stop verbatim', () => {
    for (const [ramp, stops] of Object.entries(ramps))
      for (const [stop, hex] of Object.entries(stops))
        expect(region, `${ramp}-${stop}`).toContain(`--${ramp}-${stop}: ${hex};`);
  });

  it('emits the one-offs and Tier-2 semantic defaults', () => {
    for (const [n, v] of Object.entries(oneOffs)) expect(region, n).toContain(`--${n}: ${v};`);
    for (const [n, v] of Object.entries(semanticDefaults)) expect(region, n).toContain(`--${n}: ${v};`);
  });

  it('emits every Tier-3 role binding (selector + each var)', () => {
    for (const [role, vars] of Object.entries(roleBindings)) {
      expect(region, role).toContain(`[data-role="${role}"] {`);
      for (const [n, v] of Object.entries(vars)) expect(region, `${role}.${n}`).toContain(`--${n}: ${v};`);
    }
  });

  it('emits every role × intensity binding', () => {
    for (const { role, intensity, vars } of intensityBindings) {
      expect(region).toContain(`[data-role="${role}"][data-intensity="${intensity}"] {`);
      for (const [n, v] of Object.entries(vars)) expect(region, `${role}.${intensity}.${n}`).toContain(`--${n}: ${v};`);
    }
  });

  it('exposes the @theme tokens (colours, radius, shadow, fonts)', () => {
    for (const c of theme.colors) expect(region, `color-${c}`).toContain(`--color-${c}: var(--${c});`);
    expect(region).toContain('--shadow-sticker: 3px 3px 0 var(--sidebar-edge);');
    expect(region).toContain('--shadow-sticker-lg: 6px 6px 0 var(--sidebar-edge);');
    expect(region).toContain('--font-display: var(--font-bricolage);');
    expect(region).toContain('--font-sans: var(--font-inter);');
  });
});

describe('motion tokens (consumed by framer-motion)', () => {
  it('has numeric durations, 4-point cubic-bezier eases, and spring configs', () => {
    expect(typeof motion.duration.fast).toBe('number');
    expect(motion.ease.out).toHaveLength(4);
    expect(motion.ease.inOut).toHaveLength(4);
    expect(motion.spring.calm.type).toBe('spring');
    expect(motion.spring.playful.type).toBe('spring');
  });
});
