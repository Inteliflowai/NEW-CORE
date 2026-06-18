// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@/test/setup-dom';

// We cannot import the real RootLayout (it uses next/font/google which needs the
// Next.js bundler). Instead we directly verify the font object contract:
// next/font/google returns objects whose `.variable` property equals the CSS var name
// we passed as `variable` option. The real layout.tsx passes these to <html className>.

// Import the real layout module's font variables via a mock — or test the contract
// by verifying the font variable strings that next/font would produce.
// next/font is mocked by the bundler; in vitest we confirm the variable names directly.

// The contract is: layout.tsx must apply className strings containing
// '--font-bricolage' and '--font-inter' to the <html> element.
// We test this by importing the font instances from layout.tsx if possible,
// or by asserting the font variable strings the @theme depends on.

// Since next/font/google requires the Next.js bundler transform, we test the
// font variable name contract statically by reading layout.tsx source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const layoutSrc = readFileSync(
  join(process.cwd(), 'src/app/layout.tsx'),
  'utf-8'
);

describe('RootLayout font variable contract', () => {
  it('imports Bricolage_Grotesque from next/font/google', () => {
    expect(layoutSrc).toContain('Bricolage_Grotesque');
    expect(layoutSrc).toContain('next/font/google');
  });

  it('imports Inter from next/font/google', () => {
    expect(layoutSrc).toContain('Inter');
    expect(layoutSrc).toContain('next/font/google');
  });

  it('configures Bricolage_Grotesque with variable --font-bricolage', () => {
    // The variable option value must be exactly "--font-bricolage"
    expect(layoutSrc).toMatch(/variable:\s*["']--font-bricolage["']/);
  });

  it('configures Inter with variable --font-inter', () => {
    // The variable option value must be exactly "--font-inter"
    expect(layoutSrc).toMatch(/variable:\s*["']--font-inter["']/);
  });

  it('applies font variable classNames to <html> element', () => {
    // The layout must spread both font .variable values onto the html className
    expect(layoutSrc).toContain('bricolage.variable');
    expect(layoutSrc).toContain('inter.variable');
  });

  it('does not import Geist fonts (removed)', () => {
    expect(layoutSrc).not.toContain('Geist');
  });

  it('still imports globals.css', () => {
    expect(layoutSrc).toContain('./globals.css');
  });
});
