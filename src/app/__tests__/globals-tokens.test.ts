import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf-8');

describe('globals.css token contract', () => {
  // Tier-2 semantic slots must exist
  it('defines all required Tier-2 semantic slots in :root', () => {
    const required = [
      '--bg', '--surface', '--fg', '--fg-muted',
      '--brand', '--brand-accent', '--fg-on-brand',
      '--ok', '--warn', '--risk',
      '--radius', '--radius-lg', '--shadow', '--shadow-pop',
    ];
    for (const slot of required) {
      expect(css, `missing slot ${slot}`).toContain(slot + ':');
    }
  });

  // Tier-1 ramp presence (spot-check boundary stops)
  it('defines Tier-1 primitive ramps for all 6 color families', () => {
    const families = ['--emerald-', '--lime-', '--cobalt-', '--coral-', '--amber-', '--ink-'];
    for (const f of families) {
      expect(css, `missing ramp ${f}`).toContain(f);
    }
  });

  // Role selectors for all 5 roles
  it('has data-role binding selectors for all 5 roles', () => {
    const roles = ['student', 'teacher', 'parent', 'admin', 'super-admin'];
    for (const role of roles) {
      expect(css, `missing selector for role=${role}`).toContain(`data-role="${role}"`);
    }
  });

  // data-intensity selectors
  it('has data-intensity selectors for loud and calm', () => {
    expect(css).toContain('data-intensity="loud"');
    expect(css).toContain('data-intensity="calm"');
  });

  // No raw hex values outside :root — everything between a } and :root { must be var() references
  it('has no raw hex literals outside :root', () => {
    // Strip :root block(s), then check no #xxxxxx remain
    // Note: use [^}]* without the `s` flag (ES2017 compat) — works since :root blocks don't nest
    const withoutRoot = css.replace(/:root\s*\{[^}]*\}/g, '');
    const hexMatches = withoutRoot.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexMatches, `raw hex outside :root: ${hexMatches.join(', ')}`).toHaveLength(0);
  });

  // @theme block maps brand/fg/bg
  it('has @theme block mapping Tier-2 slots to Tailwind v4 utilities', () => {
    expect(css).toContain('@theme');
    expect(css).toContain('--color-brand:');
    expect(css).toContain('--color-bg:');
    expect(css).toContain('--color-fg:');
  });
});
