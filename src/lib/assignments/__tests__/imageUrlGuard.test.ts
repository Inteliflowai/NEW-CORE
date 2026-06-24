// src/lib/assignments/__tests__/imageUrlGuard.test.ts
import { describe, it, expect } from 'vitest';
import { isProxyImageUrl, isOwnedProxyImageUrl, responsesImageUrlsOk } from '@/lib/assignments/imageUrlGuard';

const proxy = (path: string) => `/api/attempts/drawing?path=${encodeURIComponent(path)}`;

describe('isProxyImageUrl', () => {
  it('accepts a well-formed proxy URL', () => {
    expect(isProxyImageUrl(proxy('stu1/A1/task-1-1.png'))).toBe(true);
  });
  it('rejects external URLs and non-strings', () => {
    expect(isProxyImageUrl('https://attacker.example/x.gif')).toBe(false);
    expect(isProxyImageUrl('/api/attempts/drawing')).toBe(false); // no ?path=
    expect(isProxyImageUrl('/api/attempts/drawing?path=')).toBe(false); // empty path
    expect(isProxyImageUrl(42)).toBe(false);
    expect(isProxyImageUrl(null)).toBe(false);
  });
});

describe('isOwnedProxyImageUrl', () => {
  it('treats null/undefined as fine (no image)', () => {
    expect(isOwnedProxyImageUrl(null, 'stu1')).toBe(true);
    expect(isOwnedProxyImageUrl(undefined, 'stu1')).toBe(true);
  });
  it("accepts the caller's own proxy path", () => {
    expect(isOwnedProxyImageUrl(proxy('stu1/A1/task-1-1.png'), 'stu1')).toBe(true);
  });
  it('rejects an external URL', () => {
    expect(isOwnedProxyImageUrl('https://attacker.example/x.gif', 'stu1')).toBe(false);
  });
  it("rejects another student's proxy path", () => {
    expect(isOwnedProxyImageUrl(proxy('stu2/A1/task-1-1.png'), 'stu1')).toBe(false);
  });
  it('rejects a traversal path', () => {
    expect(isOwnedProxyImageUrl(proxy('stu1/../stu2/A1/x.png'), 'stu1')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isOwnedProxyImageUrl(42, 'stu1')).toBe(false);
    expect(isOwnedProxyImageUrl({}, 'stu1')).toBe(false);
  });
});

describe('responsesImageUrlsOk', () => {
  it('passes over a multi-task object where every image_url is owned (or null)', () => {
    const responses = {
      tasks: {
        '1': { text: 'a', image_url: null },
        '2': { text: 'b', image_url: proxy('stu1/A1/task-2-9.jpg') },
        '3': { text: 'c', image_url: undefined },
      },
    };
    expect(responsesImageUrlsOk(responses, 'stu1')).toBe(true);
  });
  it('fails if ANY task carries a non-owned image_url', () => {
    const responses = {
      tasks: {
        '1': { text: 'a', image_url: proxy('stu1/A1/task-1-1.png') },
        '2': { text: 'b', image_url: 'https://attacker.example/x.gif' },
      },
    };
    expect(responsesImageUrlsOk(responses, 'stu1')).toBe(false);
  });
  it('handles missing/empty tasks gracefully', () => {
    expect(responsesImageUrlsOk(null, 'stu1')).toBe(true);
    expect(responsesImageUrlsOk({}, 'stu1')).toBe(true);
    expect(responsesImageUrlsOk({ tasks: {} }, 'stu1')).toBe(true);
  });
});
