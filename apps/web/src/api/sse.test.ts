import { describe, expect, it } from 'vitest';
import { createSseParser, readSseStream, type SseFrame } from './sse';

/** Feeds chunks in order and returns every frame produced. */
const parseAll = (...chunks: string[]): SseFrame[] => {
  const parser = createSseParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
};

/** A ReadableStream of UTF-8 encoded chunks, for the reader tests. */
const streamOf = (...chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

describe('createSseParser', () => {
  it('parses a single complete frame', () => {
    expect(parseAll('event: delta\ndata: {"text":"hi"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"hi"}' },
    ]);
  });

  it('defaults the event name to "message" when the server omits it', () => {
    expect(parseAll('data: bare\n\n')).toEqual([{ event: 'message', data: 'bare' }]);
  });

  it('emits nothing until a frame is terminated by a blank line', () => {
    const parser = createSseParser();
    expect(parser.push('event: delta\ndata: partial')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ event: 'delta', data: 'partial' }]);
  });

  it('reassembles a frame split across several chunks', () => {
    expect(parseAll('eve', 'nt: delta\nda', 'ta: split\n', '\n')).toEqual([
      { event: 'delta', data: 'split' },
    ]);
  });

  it('returns several frames arriving in one chunk', () => {
    expect(parseAll('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('joins multiple data lines with a newline', () => {
    expect(parseAll('event: x\ndata: one\ndata: two\n\n')).toEqual([
      { event: 'x', data: 'one\ntwo' },
    ]);
  });

  it('strips exactly one leading space after the colon', () => {
    // Two spaces means the value legitimately starts with one.
    expect(parseAll('data:  padded\n\n')).toEqual([{ event: 'message', data: ' padded' }]);
  });

  it('handles a field with no colon at all as an empty value', () => {
    expect(parseAll('data\n\n')).toEqual([{ event: 'message', data: '' }]);
  });

  it('ignores comment lines used as keepalives', () => {
    expect(parseAll(': keepalive\nevent: delta\ndata: after\n\n')).toEqual([
      { event: 'delta', data: 'after' },
    ]);
  });

  it('ignores unknown fields so the service can add them safely', () => {
    expect(parseAll('retry: 3000\nfuture: value\ndata: kept\n\n')).toEqual([
      { event: 'message', data: 'kept' },
    ]);
  });

  it('carries the id field through', () => {
    expect(parseAll('id: 7\ndata: x\n\n')).toEqual([
      { event: 'message', data: 'x', id: '7' },
    ]);
  });

  it('does not emit a frame for a block with no data field', () => {
    // Per spec this only resets the event type; it is not an event.
    expect(parseAll('event: lonely\n\ndata: real\n\n')).toEqual([
      { event: 'message', data: 'real' },
    ]);
  });

  describe('line terminators', () => {
    it('accepts CRLF', () => {
      expect(parseAll('event: delta\r\ndata: crlf\r\n\r\n')).toEqual([
        { event: 'delta', data: 'crlf' },
      ]);
    });

    it('accepts a bare CR as a line terminator', () => {
      const parser = createSseParser();
      // A trailing CR is deliberately withheld: it may be the first half of a
      // CRLF that has not arrived yet, so the line it ends is not yet complete.
      expect(parser.push('event: delta\rdata: cr\r')).toEqual([]);
      // Anything other than an LF next confirms the CR terminated the line,
      // and the blank line that follows dispatches the frame.
      expect(parser.push('\rtrailing')).toEqual([{ event: 'delta', data: 'cr' }]);
    });

    it('does not dispatch early when a CRLF is split across two chunks', () => {
      // The regression this guards: treating the trailing CR as a complete
      // line terminator ends the frame one line early and loses the rest.
      const parser = createSseParser();
      expect(parser.push('event: delta\r\ndata: whole\r')).toEqual([]);
      expect(parser.push('\n\r\n')).toEqual([{ event: 'delta', data: 'whole' }]);
    });
  });

  it('keeps parser state independent between instances', () => {
    const a = createSseParser();
    const b = createSseParser();
    a.push('data: from-a');
    expect(b.push('data: from-b\n\n')).toEqual([{ event: 'message', data: 'from-b' }]);
  });
});

describe('readSseStream', () => {
  const collect = async (
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<SseFrame[]> => {
    const frames: SseFrame[] = [];
    for await (const frame of readSseStream(stream, signal)) frames.push(frame);
    return frames;
  };

  it('yields frames from a response body', async () => {
    const frames = await collect(streamOf('event: status\ndata: {"stage":"x"}\n\n'));
    expect(frames).toEqual([{ event: 'status', data: '{"stage":"x"}' }]);
  });

  it('decodes a multi-byte character split across chunk boundaries', async () => {
    // The em dash is three bytes; the stream is cut through the middle of it.
    const bytes = new TextEncoder().encode('data: a—b\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ event: 'message', data: 'a—b' }]);
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect(streamOf('data: x\n\n'), controller.signal)).rejects.toThrow(
      /abort/i,
    );
  });

  it('throws rather than ending quietly when aborted mid-stream', async () => {
    // Stopping must be distinguishable from finishing, otherwise a cancelled
    // answer renders as a complete one.
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: first\n\n'));
        controller.abort();
        streamController.enqueue(encoder.encode('data: second\n\n'));
        streamController.close();
      },
    });

    const frames: SseFrame[] = [];
    await expect(
      (async () => {
        for await (const frame of readSseStream(stream, controller.signal)) {
          frames.push(frame);
        }
      })(),
    ).rejects.toThrow(/abort/i);
  });
});
