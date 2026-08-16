import { describe, expect, it } from 'vitest';
import { TraceRecorder, formatDuration, formatTokens } from './trace';

/** A clock the test drives, so timings are asserted rather than approximated. */
function fakeClock() {
  let now = 0;
  return {
    read: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('TraceRecorder', () => {
  it('times each phase from when the next one starts', () => {
    const clock = fakeClock();
    const recorder = new TraceRecorder(clock.read);

    recorder.startPhase('retrieval', 'Querying knowledge graph...');
    clock.advance(120);
    recorder.startPhase('processing', 'Ranking 14 candidates...');
    clock.advance(30);
    recorder.startPhase('generation', 'Generating response...');
    clock.advance(2000);
    recorder.finish({});

    const { phases } = recorder.snapshot();
    expect(phases.map((phase) => phase.durationMs)).toEqual([120, 30, 2000]);
  });

  it('reports total wall-clock across every phase', () => {
    const clock = fakeClock();
    const recorder = new TraceRecorder(clock.read);

    recorder.startPhase('retrieval', 'a');
    clock.advance(100);
    recorder.startPhase('generation', 'b');
    clock.advance(400);
    recorder.finish({});

    expect(recorder.snapshot().totalMs).toBe(500);
  });

  it('records when the answer started arriving', () => {
    // The number users feel most: a reasoning model thinks first, so this is
    // usually the longest wait in the query.
    const clock = fakeClock();
    const recorder = new TraceRecorder(clock.read);

    recorder.startPhase('generation', 'Generating response...');
    clock.advance(1800);
    recorder.markFirstToken();
    clock.advance(50);
    recorder.markFirstToken();
    recorder.finish({});

    expect(recorder.snapshot().firstTokenMs).toBe(1800);
  });

  it('carries what the service reported about itself', () => {
    const recorder = new TraceRecorder(fakeClock().read);
    recorder.startPhase('retrieval', 'a');
    recorder.finish({
      usage: { input_tokens: 341, output_tokens: 810 },
      model: 'anthropic/claude-opus-5',
      backend: 'fixtures',
      candidates: 14,
    });

    expect(recorder.snapshot()).toMatchObject({
      usage: { input_tokens: 341, output_tokens: 810 },
      model: 'anthropic/claude-opus-5',
      backend: 'fixtures',
      candidates: 14,
    });
  });

  it('still reports timings for a query that was stopped', () => {
    // A stopped answer is exactly when someone wants to know where the time
    // went, so an abandoned trace must not come back empty.
    const clock = fakeClock();
    const recorder = new TraceRecorder(clock.read);

    recorder.startPhase('generation', 'Generating response...');
    clock.advance(700);
    recorder.abandon();

    const snapshot = recorder.snapshot();
    expect(snapshot.phases[0]?.durationMs).toBe(700);
    expect(snapshot.totalMs).toBe(700);
  });

  it('leaves a running phase open rather than inventing a duration', () => {
    const recorder = new TraceRecorder(fakeClock().read);
    recorder.startPhase('retrieval', 'a');

    expect(recorder.snapshot().phases[0]?.durationMs).toBeUndefined();
    expect(recorder.snapshot().totalMs).toBeUndefined();
  });

  it('returns a copy, so a later frame cannot mutate a rendered trace', () => {
    const clock = fakeClock();
    const recorder = new TraceRecorder(clock.read);
    recorder.startPhase('retrieval', 'a');
    clock.advance(10);
    const before = recorder.snapshot();

    recorder.startPhase('generation', 'b');
    expect(before.phases).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('keeps sub-second timings in milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(842)).toBe('842ms');
  });

  it('switches to seconds, losing precision as the number grows', () => {
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(42_000)).toBe('42.0s');
  });

  it('groups long token counts so they stay scannable', () => {
    expect(formatTokens(1234567)).toBe((1234567).toLocaleString());
  });
});
