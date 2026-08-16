/**
 * Timing a query as it happens.
 *
 * The service reports what it did; only the client can report how long any of
 * it took to arrive, because that is the latency a person actually experiences
 * — queueing, network and streaming included. So phases are timed here, from
 * the `status` frames the pipeline already emits.
 *
 * The gap this exists to explain: a reasoning model thinks before it writes,
 * so the generation phase begins with a long silence. Without a trace that
 * reads as the app having hung.
 */

import type { DonePayload, RetrievalPhase, UsagePayload } from '@/types';

export interface TracePhase {
  phase: RetrievalPhase;
  label: string;
  /** Milliseconds from the query starting to this phase beginning. */
  startedAt: number;
  /** Milliseconds this phase lasted, absent while it is still running. */
  durationMs?: number;
}

export interface QueryTrace {
  phases: TracePhase[];
  /** Wall-clock from submit to the last frame, absent until the query ends. */
  totalMs?: number;
  /** When the first answer token arrived — the number users feel most. */
  firstTokenMs?: number;
  usage?: UsagePayload;
  model?: string;
  backend?: string;
  candidates?: number;
}

/**
 * Accumulates a trace from stream events.
 *
 * Deliberately a plain object rather than React state: it updates many times
 * per second while tokens stream, and re-rendering the conversation on every
 * delta to move a millisecond counter would cost far more than the panel is
 * worth. The UI reads it when a query ends.
 */
export class TraceRecorder {
  private readonly startedAt: number;
  private readonly phases: TracePhase[] = [];
  private firstTokenAt?: number;
  private summary: Pick<QueryTrace, 'usage' | 'model' | 'backend' | 'candidates'> = {};

  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
  }

  /** Opens a new phase and closes the previous one. */
  startPhase(phase: RetrievalPhase, label: string): void {
    const at = this.now() - this.startedAt;
    this.closeLast(at);
    this.phases.push({ phase, label, startedAt: at });
  }

  /** Records the first answer token; later tokens are ignored. */
  markFirstToken(): void {
    this.firstTokenAt ??= this.now() - this.startedAt;
  }

  finish(done: DonePayload): void {
    this.closeLast(this.now() - this.startedAt);
    this.summary = {
      ...(done.usage ? { usage: done.usage } : {}),
      ...(done.model ? { model: done.model } : {}),
      ...(done.backend ? { backend: done.backend } : {}),
      ...(done.candidates !== undefined ? { candidates: done.candidates } : {}),
    };
  }

  /** Closes the open phase so a stopped or failed query still reports timings. */
  abandon(): void {
    this.closeLast(this.now() - this.startedAt);
  }

  private closeLast(at: number): void {
    const last = this.phases[this.phases.length - 1];
    if (last && last.durationMs === undefined) {
      last.durationMs = at - last.startedAt;
    }
  }

  snapshot(): QueryTrace {
    const last = this.phases[this.phases.length - 1];
    const ended =
      last?.durationMs !== undefined ? last.startedAt + last.durationMs : undefined;

    return {
      phases: this.phases.map((phase) => ({ ...phase })),
      ...(ended !== undefined ? { totalMs: ended } : {}),
      ...(this.firstTokenAt !== undefined ? { firstTokenMs: this.firstTokenAt } : {}),
      ...this.summary,
    };
  }
}

/** Milliseconds as something readable at a glance. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

/** Thousands separators, so six-figure token counts stay scannable. */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}
