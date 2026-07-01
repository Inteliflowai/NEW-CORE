// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import StudentWorkPanel from '../StudentWorkPanel';
import type { DisplaySegment } from '@/lib/spark/formatStepResponse';

// Loosely typed (not the exact literal-inferred shape) so structuredClone()
// mutations below (steps:null, extra/empty segmentsByStep keys, emptied
// responseIndexes) type-check — this is fixture data for a mocked fetch
// Response body, not a value consumed directly by application code.
interface PanelBody {
  review: {
    attempt: { state: string; startedAt: string | null; completedAt: string | null; score: number | null;
               effortLabel: string | null; revisionCount: number | null; teliHintCount: number | null };
    generationStatus: string | null;
    steps: { order: number; title: string; type: string; description: string }[] | null;
    analysis: { rubric_dimensions: Record<string, number | null>; dimension_observations: Record<string, string>;
                key_observations: string[]; content_quality: string } | null;
  };
  responseIndexes: number[];
  segmentsByStep: Record<string, DisplaySegment[]>;
}

const OK_BODY: PanelBody = {
  review: {
    attempt: { state: 'completed', startedAt: null, completedAt: '2026-07-01T10:40:00Z',
               score: 80, effortLabel: 'effortful_success', revisionCount: 2, teliHintCount: 1 },
    generationStatus: 'ready',
    steps: [
      { order: 1, title: 'The Challenge', type: 'instruction', description: 'A boat scenario.' },
      { order: 2, title: 'Make a Prediction', type: 'prediction', description: 'What do you predict?' },
    ],
    analysis: { rubric_dimensions: { creativity: 4 }, dimension_observations: { creativity: 'inventive' },
                key_observations: ['kept revising'], content_quality: 'engaged' },
  },
  responseIndexes: [1],
  segmentsByStep: { 1: [
    { kind: 'text', label: 'Prediction', text: 'It floats' },
    { kind: 'image', label: 'Drawing', dataUrl: 'data:image/png;base64,AAAA' },
  ] },
};

describe('StudentWorkPanel', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches on mount and renders steps, answers and observations', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(OK_BODY), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    // regex, not exact: the markup renders '2. Make a Prediction' as one text run
    await waitFor(() => expect(screen.getByText(/Make a Prediction/)).toBeInTheDocument());
    expect(screen.getByText('It floats')).toBeInTheDocument();
    expect(screen.getByText('kept revising')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: /drawing/i });
    expect(img.getAttribute('src')).toMatch(/^data:image\//);
  });

  it('quiet friendly state ONLY for the not_started 404 body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_started' }), { status: 404 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/don.t see this student.s work in SPARK yet/i)).toBeInTheDocument());
  });

  it('other 404s (spark_not_enabled) get the generic state, never the false not-started claim', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'spark_not_enabled' }), { status: 404 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/couldn.t reach SPARK right now/i)).toBeInTheDocument());
    expect(screen.queryByText(/don.t see this student.s work/i)).toBeNull();
  });

  it('labels the synthetic extension index 9999 and sorts it last', async () => {
    const body = structuredClone(OK_BODY);
    body.responseIndexes = [9999, 1];
    body.segmentsByStep['9999'] = [{ kind: 'text', label: 'Claim', text: 'extension claim' }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/Extension problem/)).toBeInTheDocument());
    expect(screen.queryByText(/Step 10000/)).toBeNull();
    const blocks = screen.getAllByText(/Extension problem|Make a Prediction/).map((n) => n.textContent);
    expect(blocks[blocks.length - 1]).toMatch(/Extension problem/); // extension renders after step answers
  });

  it('empty answers → quiet "No written answers yet."', async () => {
    const body = structuredClone(OK_BODY);
    body.responseIndexes = [];
    body.segmentsByStep = {};
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText('No written answers yet.')).toBeInTheDocument());
  });

  it('steps:null (pre-025 / failed generation) → answers render under "Step N" fallback labels', async () => {
    const body = structuredClone(OK_BODY);
    body.review.steps = null;
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeInTheDocument()); // idx 1 → 'Step 2'
    expect(screen.getByText('It floats')).toBeInTheDocument();
    expect(screen.queryByText(/challenge this student saw/i)).toBeNull();
  });

  it('fail-soft state when SPARK is unreachable (502)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'spark_unreachable' }), { status: 502 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/couldn.t reach SPARK right now/i)).toBeInTheDocument());
  });

  it('never renders an img for a non-data URL even if the API is compromised', async () => {
    const evil = structuredClone(OK_BODY);
    evil.segmentsByStep[1][1] = { kind: 'image', label: 'Drawing', dataUrl: 'https://evil.example/x.png' };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(evil), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText('It floats')).toBeInTheDocument());
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a loading state while fetching', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<StudentWorkPanel assignmentId="a1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
