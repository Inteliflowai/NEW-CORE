'use client';

/**
 * MathText — renders inline $…$ and block $$…$$ math via KaTeX.
 * On a KaTeX parse error the raw delimited segment is shown as-is (never blank, never throws).
 * Colors inherit from the parent via CSS; no hardcoded hex.
 *
 * KaTeX CSS is loaded globally via src/app/globals.css:
 *   @import "katex/dist/katex.min.css";
 */

import React from 'react';
import katex from 'katex';

export interface MathTextProps {
  children: string;
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'math-block'; value: string }
  | { type: 'math-inline'; value: string };

/**
 * Split a string into plain-text and math segments.
 * Block ($$…$$) is matched before inline ($…$) to avoid partial matches.
 */
function parseSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  // Match block $$…$$ first (longer delimiter), then inline $…$
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    const [full] = match;
    const start = match.index;

    if (start > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, start) });
    }

    if (full.startsWith('$$')) {
      segments.push({ type: 'math-block', value: full.slice(2, -2) });
    } else {
      segments.push({ type: 'math-inline', value: full.slice(1, -1) });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', value: input.slice(lastIndex) });
  }

  return segments;
}

/**
 * Render a math segment via KaTeX.
 * On parse error, returns the raw delimited text as a fallback — never blank, never throws.
 */
function renderMathSegment(
  tex: string,
  displayMode: boolean,
  rawFallback: string,
  key: number
): React.ReactNode {
  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: false,
    });
    return (
      <span
        key={key}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    // Safe degrade: show the original delimited text so the reader knows math was intended.
    // Never blank, never throws — quiz items remain readable.
    return <span key={key}>{rawFallback}</span>;
  }
}

/**
 * Renders a string containing inline $…$ and/or block $$…$$ math expressions.
 * Plain text segments pass through unchanged. Math segments are rendered via KaTeX.
 * Malformed expressions degrade to raw text; the component never throws or blanks.
 */
export function MathText({ children }: MathTextProps) {
  const segments = parseSegments(children);

  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.value}</span>;
        }
        const displayMode = seg.type === 'math-block';
        const delimiter = displayMode ? '$$' : '$';
        const rawFallback = `${delimiter}${seg.value}${delimiter}`;
        return renderMathSegment(seg.value, displayMode, rawFallback, i);
      })}
    </span>
  );
}

export default MathText;
