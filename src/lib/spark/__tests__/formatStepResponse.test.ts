import { describe, it, expect } from 'vitest';
import { formatStepResponse } from '@/lib/spark/formatStepResponse';

describe('formatStepResponse', () => {
  it('prediction → text + confidence line', () => {
    const segs = formatStepResponse('prediction', { text: 'It floats', confidence: 70 });
    expect(segs).toEqual([
      { kind: 'text', label: 'Prediction', text: 'It floats' },
      { kind: 'text', label: 'Confidence', text: '70 / 100' },
    ]);
  });

  it('claim_evidence → three labeled texts', () => {
    expect(formatStepResponse('claim_evidence', { claim: 'c', evidence: 'e', reasoning: 'r' }))
      .toEqual([
        { kind: 'text', label: 'Claim', text: 'c' },
        { kind: 'text', label: 'Evidence', text: 'e' },
        { kind: 'text', label: 'Reasoning', text: 'r' },
      ]);
  });

  it('multiple_choice → selection + rationale, skipping empty rationale', () => {
    expect(formatStepResponse('multiple_choice', { selected: ['Poster'], rationale: '' }))
      .toEqual([{ kind: 'text', label: 'Chose', text: 'Poster' }]);
  });

  it('reflection → one segment per answered prompt, labeled by the prompt', () => {
    expect(formatStepResponse('reflection', {
      prompts: ['What changed?', 'What next?'], responses: { 0: 'My view', 1: '' },
    })).toEqual([{ kind: 'text', label: 'What changed?', text: 'My view' }]);
  });

  it('drawing → image segment ONLY for data:image/ values', () => {
    expect(formatStepResponse('drawing', { data_url: 'data:image/png;base64,AAAA' }))
      .toEqual([{ kind: 'image', label: 'Drawing', dataUrl: 'data:image/png;base64,AAAA' }]);
  });

  it('SECURITY: drawing with a non-data URL never becomes an image', () => {
    const segs = formatStepResponse('drawing', { data_url: 'https://evil.example/track.png' });
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
    expect(JSON.stringify(segs)).not.toContain('evil.example');
  });

  it('SECURITY: observation image_url is never emitted; text only', () => {
    const segs = formatStepResponse('observation', { text: 'saw bubbles', image_url: 'blob:https://x/y' });
    expect(segs).toEqual([{ kind: 'text', label: 'Observation', text: 'saw bubbles' }]);
  });

  it('instruction acknowledged → empty (context step, not an answer)', () => {
    expect(formatStepResponse('instruction', { acknowledged: true })).toEqual([]);
  });

  it('comparison, data_entry, code_block, hardware_control, unknown all render safely', () => {
    expect(formatStepResponse('comparison', { side_a: 'a', side_b: 'b', synthesis: 's' })).toHaveLength(3);
    expect(formatStepResponse('data_entry', { data: { mass: '5', unit: 'kg' } })).toEqual([
      { kind: 'text', label: 'mass', text: '5' }, { kind: 'text', label: 'unit', text: 'kg' },
    ]);
    expect(formatStepResponse('code_block', { code: 'print(1)', language: 'python' })).toEqual([
      { kind: 'text', label: 'Code (python)', text: 'print(1)' },
    ]);
    expect(formatStepResponse('hardware_control', { sensor_data: { temp: 21 }, commands_sent: 3 })[0].kind).toBe('text');
    expect(formatStepResponse('wat', { anything: 1 })).toEqual([
      { kind: 'text', label: 'Answer', text: '(unrecognized answer format)' },
    ]);
  });

  it('code_block with no language → bare "Code" label, not the misleading "Code (code)"', () => {
    expect(formatStepResponse('code_block', { code: 'print(1)' })).toEqual([
      { kind: 'text', label: 'Code', text: 'print(1)' },
    ]);
    expect(formatStepResponse('code_block', { code: 'print(1)', language: '' })).toEqual([
      { kind: 'text', label: 'Code', text: 'print(1)' },
    ]);
  });
});
