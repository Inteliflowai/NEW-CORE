import { describe, it, expect } from 'vitest';
import { alertTriggerLabel, ALERT_BUCKETS, severityTone, type AlertSourceKind } from '@/lib/copy/alertTriggerLabel';
import { hasBannedWord } from '@/lib/copy/leakGuard';

describe('alertTriggerLabel', () => {
  const kinds: AlertSourceKind[] = ['low_quiz','low_assignment','reteach_flag','reteach_review','strong_result'];
  it('gives a label for every kind and never uses a banned word', () => {
    for (const k of kinds) {
      const label = alertTriggerLabel(k);
      expect(label.length).toBeGreaterThan(0);
      expect(hasBannedWord(label), `banned word in ${k}: ${label}`).toBe(false);
    }
  });
  it('never uses the literal word "homework"', () => {
    for (const k of kinds) expect(alertTriggerLabel(k).toLowerCase()).not.toContain('homework');
  });
  it('orders buckets urgent → watch → info', () => {
    expect(ALERT_BUCKETS.map((b) => b.severity)).toEqual(['urgent','watch','info']);
  });
  it('maps severity to a token tone', () => {
    expect(severityTone('urgent')).toBe('risk');
    expect(severityTone('watch')).toBe('warn');
    expect(severityTone('info')).toBe('brand');
  });
});
