import { describe, it, expect } from 'vitest';
import { contrastRatio, checkAllPairs, parseCss, buildPalettes, resolveToHex } from '../contrast-check';

// ---------------------------------------------------------------------------
// 1. WCAG luminance / contrast math
// ---------------------------------------------------------------------------
describe('contrastRatio()', () => {
  it('returns ~21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('returns ~1 for identical colors', () => {
    expect(contrastRatio('#aabbcc', '#aabbcc')).toBeCloseTo(1, 1);
  });

  it('is commutative', () => {
    const a = contrastRatio('#059669', '#ffffff');
    const b = contrastRatio('#ffffff', '#059669');
    expect(a).toBeCloseTo(b, 5);
  });

  it('catches a deliberately dim pair (near-gray fg on white bg) below 4.5:1', () => {
    // #a8a8a8 on #ffffff = ~3.6:1 — fails body-text AA threshold
    const ratio = contrastRatio('#a8a8a8', '#ffffff');
    expect(ratio).toBeLessThan(4.5);
    // Verify it's in the ballpark (not a broken implementation returning 0 or 21)
    expect(ratio).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// 2. CSS parser + var() resolution
// ---------------------------------------------------------------------------
describe('parseCss() + resolveToHex()', () => {
  it('parses :root custom properties correctly', () => {
    const css = `
      :root {
        --emerald-600: #059669;
        --ink-900: #171717;
        --white: #ffffff;
        --fg: var(--ink-900);
      }
    `;
    const { rootProps } = parseCss(css);
    expect(rootProps.get('--emerald-600')).toBe('#059669');
    expect(rootProps.get('--ink-900')).toBe('#171717');
    expect(rootProps.get('--fg')).toBe('var(--ink-900)');
  });

  it('resolves a direct hex immediately', () => {
    const props = new Map([['--x', '#ff0000']]);
    expect(resolveToHex('#ff0000', props, 'test')).toBe('#ff0000');
  });

  it('follows a single var() hop to hex', () => {
    const props = new Map([['--ink-900', '#171717']]);
    expect(resolveToHex('var(--ink-900)', props, 'test')).toBe('#171717');
  });

  it('follows a two-hop var() chain', () => {
    const props = new Map([
      ['--fg', 'var(--ink-900)'],
      ['--ink-900', '#171717'],
    ]);
    expect(resolveToHex('var(--fg)', props, 'test')).toBe('#171717');
  });

  it('expands 3-digit hex to 6-digit', () => {
    const props = new Map([['--x', '#fff']]);
    expect(resolveToHex('#fff', props, 'test')).toBe('#ffffff');
  });

  it('throws on an unresolvable chain', () => {
    const props = new Map([['--x', 'var(--missing)']]);
    expect(() => resolveToHex('var(--x)', props, 'role/intensity slot="fg"'))
      .toThrow(/--missing/);
  });

  it('discovers role selectors correctly', () => {
    const css = `
      :root { --white: #ffffff; --ink-900: #171717; --ink-600: #525252; --ink-50: #f8f8f8; }
      [data-role="student"] {
        --bg: var(--ink-50);
        --surface: var(--white);
        --fg: var(--ink-900);
        --fg-muted: var(--ink-600);
        --brand: #059669;
        --fg-on-brand: var(--white);
      }
      [data-role="student"][data-intensity="loud"] {
        --radius: 0.75rem;
      }
    `;
    const { roleSlots } = parseCss(css);
    expect(roleSlots.has('student')).toBe(true);
    const studentSlots = roleSlots.get('student')!;
    // Should have '' (role-only) and 'loud' (intensity) entries
    expect(studentSlots.has('')).toBe(true);
    expect(studentSlots.has('loud')).toBe(true);
    expect(studentSlots.get('')!.brand).toBe('#059669');
  });
});

// ---------------------------------------------------------------------------
// 3. Parser resolves real globals.css correctly
// ---------------------------------------------------------------------------
describe('parseCss() against real globals.css', () => {
  it('student brand resolves to #059669 (emerald-600)', () => {
    // Build palettes from the real file (default path)
    const results = checkAllPairs();
    // Find a student entry
    const studentBrandPair = results.find(
      (r) => r.role === 'student' && r.pair === 'brand/surface'
    );
    expect(studentBrandPair).toBeDefined();
    // The fg in brand/surface is the brand color
    expect(studentBrandPair!.fg.toLowerCase()).toBe('#059669');
  });

  it('student fg resolves to #171717 (ink-900)', () => {
    const results = checkAllPairs();
    const studentFgPair = results.find(
      (r) => r.role === 'student' && r.pair === 'fg/bg'
    );
    expect(studentFgPair).toBeDefined();
    expect(studentFgPair!.fg.toLowerCase()).toBe('#171717');
  });

  it('admin bg resolves to #14132b (canvas-admin dark)', () => {
    const results = checkAllPairs();
    const adminPair = results.find(
      (r) => r.role === 'admin' && r.pair === 'fg/bg'
    );
    expect(adminPair).toBeDefined();
    expect(adminPair!.bg.toLowerCase()).toBe('#14132b');
  });
});

// ---------------------------------------------------------------------------
// 4. Passes today — true regression anchor (reads the real file)
// ---------------------------------------------------------------------------
describe('checkAllPairs() — regression anchor', () => {
  it('all pairs pass WCAG AA with current globals.css (0 failures)', () => {
    const results = checkAllPairs();
    expect(results.length).toBeGreaterThan(0);

    const failures = results.filter((r) => !r.passes);
    const msg = failures
      .map((f) => `${f.role}/${f.intensity} ${f.pair}: ratio=${f.ratio.toFixed(2)} required=${f.required}`)
      .join('\n');
    expect(failures, `Contrast failures:\n${msg}`).toHaveLength(0);
  });

  it('returns the expected shape for every result', () => {
    const results = checkAllPairs();
    for (const r of results) {
      expect(r).toHaveProperty('role');
      expect(r).toHaveProperty('intensity');
      expect(r).toHaveProperty('pair');
      expect(r).toHaveProperty('ratio');
      expect(r).toHaveProperty('passes');
      expect(r).toHaveProperty('required');
      expect(r).toHaveProperty('fg');
      expect(r).toHaveProperty('bg');
      // fg and bg must be resolved hex strings
      expect(r.fg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(r.bg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('covers all 3 new signal-pair pairs (ok/warn/risk) across all roles', () => {
    const results = checkAllPairs();
    const newPairLabels = ['ok-fg/ok-surface', 'warn-fg/warn-surface', 'risk-fg/risk-surface'];
    for (const label of newPairLabels) {
      const matching = results.filter((r) => r.pair === label);
      expect(matching.length, `Expected results for pair ${label}`).toBeGreaterThan(0);
      for (const r of matching) {
        expect(r.passes, `${r.role}/${r.intensity} ${r.pair} should pass`).toBe(true);
        expect(r.ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('total pair count is 40 (5 roles × 8 pairs each)', () => {
    const results = checkAllPairs();
    // 5 roles × 8 pairs = 40 total (was 5 roles × 5 pairs = 25 before new signal pairs)
    expect(results.length).toBe(40);
  });

  it('light-role risk-fg resolves to coral-900 (#72261c) and risk-surface to coral-50 (#fff1ee)', () => {
    const results = checkAllPairs();
    // student/teacher/parent all inherit the :root light tints
    const studentRisk = results.find(
      (r) => r.role === 'student' && r.pair === 'risk-fg/risk-surface'
    );
    expect(studentRisk).toBeDefined();
    expect(studentRisk!.fg.toLowerCase()).toBe('#72261c');  // coral-900
    expect(studentRisk!.bg.toLowerCase()).toBe('#fff1ee');  // coral-50
    expect(studentRisk!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('admin warn-fg resolves to amber-300 (#fcd34d) on amber-950 (#451a03)', () => {
    const results = checkAllPairs();
    const adminWarn = results.find(
      (r) => r.role === 'admin' && r.pair === 'warn-fg/warn-surface'
    );
    expect(adminWarn).toBeDefined();
    expect(adminWarn!.fg.toLowerCase()).toBe('#fcd34d');  // amber-300
    expect(adminWarn!.bg.toLowerCase()).toBe('#451a03');  // amber-950
    expect(adminWarn!.ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// 5. Catches a regression — the key test: dim color in fixture fails the gate
// ---------------------------------------------------------------------------
describe('checkAllPairs() — catches a regression via fixture CSS', () => {
  it('reports fg/bg as failing when fg is bound to dim #a8a8a8 (ink-400) on white bg', () => {
    // This fixture simulates a future edit where someone dulls the student fg
    // to ink-400 (#a8a8a8) on a white background — ratio ~3.6:1, below 4.5:1.
    const fixtureCss = `
      :root {
        --white: #ffffff;
        --ink-400: #a8a8a8;
        --ink-50: #f8f8f8;
        --ink-600: #525252;
        --emerald-600: #059669;
        --emerald-50: #ecfdf5;
        --emerald-800: #065f46;
        --amber-50: #fffbeb;
        --amber-900: #78350f;
        --coral-50: #fff1ee;
        --coral-900: #72261c;
        --ok-surface: var(--emerald-50);
        --ok-fg: var(--emerald-800);
        --warn-surface: var(--amber-50);
        --warn-fg: var(--amber-900);
        --risk-surface: var(--coral-50);
        --risk-fg: var(--coral-900);
      }
      [data-role="student"] {
        --bg:           var(--white);
        --surface:      var(--white);
        --fg:           var(--ink-400);
        --fg-muted:     var(--ink-600);
        --brand:        var(--emerald-600);
        --fg-on-brand:  var(--white);
      }
      [data-role="student"][data-intensity="loud"] {
        --radius: 0.75rem;
      }
    `;

    const results = checkAllPairs(fixtureCss);
    const fgBgResult = results.find(
      (r) => r.role === 'student' && r.pair === 'fg/bg'
    );

    expect(fgBgResult).toBeDefined();
    expect(fgBgResult!.passes).toBe(false);
    expect(fgBgResult!.ratio).toBeLessThan(4.5);
    // Sanity: ratio should be in the 3.x range, not 0 or 21
    expect(fgBgResult!.ratio).toBeGreaterThan(2);
  });

  it('also catches a dim fg-muted regression on white bg', () => {
    const fixtureCss = `
      :root {
        --white: #ffffff;
        --ink-300: #d1d1d1;
        --ink-900: #171717;
        --ink-50: #f8f8f8;
        --cobalt-600: #2563eb;
        --emerald-50: #ecfdf5;
        --emerald-800: #065f46;
        --amber-50: #fffbeb;
        --amber-900: #78350f;
        --coral-50: #fff1ee;
        --coral-900: #72261c;
        --ok-surface: var(--emerald-50);
        --ok-fg: var(--emerald-800);
        --warn-surface: var(--amber-50);
        --warn-fg: var(--amber-900);
        --risk-surface: var(--coral-50);
        --risk-fg: var(--coral-900);
      }
      [data-role="teacher"] {
        --bg:           var(--ink-50);
        --surface:      var(--white);
        --fg:           var(--ink-900);
        --fg-muted:     var(--ink-300);
        --brand:        var(--cobalt-600);
        --fg-on-brand:  var(--white);
      }
      [data-role="teacher"][data-intensity="calm"] {
        --radius: 0.5rem;
      }
    `;

    const results = checkAllPairs(fixtureCss);
    const fgMutedResult = results.find(
      (r) => r.role === 'teacher' && r.pair === 'fg-muted/bg'
    );

    expect(fgMutedResult).toBeDefined();
    expect(fgMutedResult!.passes).toBe(false);
    expect(fgMutedResult!.ratio).toBeLessThan(4.5);
  });
});
