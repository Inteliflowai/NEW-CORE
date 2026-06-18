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
      '--ok-surface', '--ok-fg',
      '--warn-surface', '--warn-fg',
      '--risk-surface', '--risk-fg',
      '--brand-surface', '--brand-fg',
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

  // New signal-pair @theme mappings
  it('has @theme mappings for all 6 new signal-pair tokens', () => {
    const required = [
      '--color-ok-surface:',
      '--color-ok-fg:',
      '--color-warn-surface:',
      '--color-warn-fg:',
      '--color-risk-surface:',
      '--color-risk-fg:',
    ];
    for (const token of required) {
      expect(css, `missing @theme mapping for ${token}`).toContain(token);
    }
  });

  // Brand-pill @theme mappings
  it('has @theme mappings for the 2 new brand-pill tokens', () => {
    const required = [
      '--color-brand-surface:',
      '--color-brand-fg:',
    ];
    for (const token of required) {
      expect(css, `missing @theme mapping for ${token}`).toContain(token);
    }
  });

  // C3 guard: globals.css must NOT contain custom component class selectors.
  // Only allowed selector types: :root, attribute selectors ([data-role…]/[data-intensity…]),
  // @theme/@import, and the bare `body` element selector.
  // This test would catch regressions like `.core-card { … }` being re-added.
  it('C3: contains no CSS class selectors (no .identifier rules)', () => {
    // Strategy:
    // 1. Strip @import lines (they contain paths like katex.min.css which have dots)
    // 2. Strip CSS comments
    // 3. Strip all declaration blocks (content between { and }), two passes for nesting
    // 4. Check that no class selector pattern (.identifier) remains
    // This avoids false-positives on decimal values (0.5rem) inside blocks
    // and file paths in @import statements.
    let selectors = css;
    // Strip @import lines
    selectors = selectors.replace(/@import\s+"[^"]*";?/g, '');
    // Strip /* ... */ comments
    selectors = selectors.replace(/\/\*[\s\S]*?\*\//g, '');
    // Two passes to strip { ... } blocks (handles one level of nesting like @theme { ... })
    selectors = selectors.replace(/\{[^{}]*\}/g, '{}');
    selectors = selectors.replace(/\{[^{}]*\}/g, '{}');

    // Match .identifier (a dot followed by a letter/underscore — a valid CSS class name start).
    const classMatch = selectors.match(/\.[a-zA-Z_]/);
    expect(
      classMatch,
      `C3 violation: globals.css contains a class selector: "${classMatch?.[0]}" — components must style via Tailwind utilities, not custom classes in globals.css`,
    ).toBeNull();
  });
});
