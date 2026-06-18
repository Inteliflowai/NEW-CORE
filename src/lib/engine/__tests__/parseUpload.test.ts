// src/lib/engine/__tests__/parseUpload.test.ts
import { describe, it, expect } from 'vitest';
import { extractUploadText } from '@/lib/engine/parseUpload';

describe('extractUploadText', () => {
  it('reads plain text / markdown as utf-8', async () => {
    const buf = Buffer.from('# Lesson\nPhotosynthesis basics.', 'utf-8');
    const text = await extractUploadText(buf, 'text/markdown', 'lesson.md');
    expect(text).toContain('Photosynthesis basics.');
  });
  it('falls back to utf-8 for an unknown type', async () => {
    const buf = Buffer.from('raw text body', 'utf-8');
    const text = await extractUploadText(buf, '', 'lesson.txt');
    expect(text).toContain('raw text body');
  });
});
