// The ONLY path by which a SPARK student answer becomes render input for the
// teacher panel. Media rules live here (house imageUrlGuard lesson): the
// submit API accepts arbitrary JSON, so value fields are attacker-influenced.
// - image segments ONLY for inline data:image/ payloads (drawings);
// - observation image_url (dead browser blob:) is NEVER emitted;
// - unknown shapes degrade to a text placeholder, never throw.
export type DisplaySegment =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'image'; label: string; dataUrl: string };

const DATA_IMAGE = /^data:image\//;

const t = (label: string, v: unknown): DisplaySegment[] =>
  typeof v === 'string' && v.trim() !== '' ? [{ kind: 'text', label, text: v }] : [];

export function formatStepResponse(type: string, value: unknown): DisplaySegment[] {
  const v = (value ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'instruction':
      return [];
    case 'prediction': {
      const segs = t('Prediction', v.text);
      if (typeof v.confidence === 'number' && Number.isFinite(v.confidence)) {
        segs.push({ kind: 'text', label: 'Confidence', text: `${v.confidence} / 100` });
      }
      return segs;
    }
    case 'observation':
      return t('Observation', v.text); // image_url is a dead blob: ref — never emitted
    case 'data_entry': {
      const data = (v.data ?? {}) as Record<string, unknown>;
      return Object.entries(data).flatMap(([k, val]) =>
        typeof val === 'string' || typeof val === 'number'
          ? [{ kind: 'text' as const, label: k, text: String(val) }] : []);
    }
    case 'drawing': {
      const url = v.data_url;
      if (typeof url === 'string' && DATA_IMAGE.test(url)) {
        return [{ kind: 'image', label: 'Drawing', dataUrl: url }];
      }
      return [{ kind: 'text', label: 'Drawing', text: '(drawing could not be displayed)' }];
    }
    case 'multiple_choice': {
      const selected = Array.isArray(v.selected)
        ? v.selected.filter((s): s is string => typeof s === 'string') : [];
      const segs: DisplaySegment[] =
        selected.length ? [{ kind: 'text', label: 'Chose', text: selected.join(', ') }] : [];
      return segs.concat(t('Why', v.rationale));
    }
    case 'claim_evidence':
      return [...t('Claim', v.claim), ...t('Evidence', v.evidence), ...t('Reasoning', v.reasoning)];
    case 'comparison':
      return [...t('Side A', v.side_a), ...t('Side B', v.side_b), ...t('Synthesis', v.synthesis)];
    case 'reflection': {
      const prompts = Array.isArray(v.prompts) ? v.prompts : [];
      const responses = (v.responses ?? {}) as Record<string, unknown>;
      return prompts.flatMap((p, i) =>
        typeof p === 'string' ? t(p, responses[String(i)]) : []);
    }
    case 'hardware_control': {
      const sensors = (v.sensor_data ?? {}) as Record<string, unknown>;
      const parts = Object.entries(sensors)
        .filter(([, val]) => typeof val === 'number')
        .map(([k, val]) => `${k}: ${val}`);
      return parts.length
        ? [{ kind: 'text', label: 'Sensor data', text: parts.join(' · ') }] : [];
    }
    case 'code_block': {
      const lang = typeof v.language === 'string' && v.language.trim() !== '' ? v.language : null;
      const label = lang ? `Code (${lang})` : 'Code';
      return typeof v.code === 'string' && v.code.trim() !== ''
        ? [{ kind: 'text', label, text: v.code }] : [];
    }
    default:
      return [{ kind: 'text', label: 'Answer', text: '(unrecognized answer format)' }];
  }
}
