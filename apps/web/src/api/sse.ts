/**
 * Server-Sent Events parsing, following the HTML specification:
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * `EventSource` cannot be used here: it only issues GET requests and cannot
 * carry a JSON body or an Authorization header. So we read the response body
 * ourselves. See docs/adr/0001-sse-over-eventsource.md.
 *
 * The parser is a pure function over chunks, kept separate from the stream
 * reading so it can be tested without a network or a ReadableStream.
 */

export interface SseFrame {
  /** From the `event:` field; `message` when the server omits it. */
  event: string;
  /** Concatenated `data:` lines, joined with newlines. */
  data: string;
  /** From the `id:` field. Our service emits none. */
  id?: string;
}

export interface SseParser {
  /** Feed a decoded chunk; returns whatever frames it completed, often none. */
  push(chunk: string): SseFrame[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  let dataLines: string[] = [];
  let eventType = '';
  let lastId: string | undefined;

  // A blank line dispatches. Per spec a block carrying no `data:` field is not
  // an event at all — it just resets the accumulated event type.
  const dispatch = (out: SseFrame[]): void => {
    if (dataLines.length === 0) {
      eventType = '';
      return;
    }
    const frame: SseFrame = {
      event: eventType || 'message',
      data: dataLines.join('\n'),
    };
    if (lastId !== undefined) frame.id = lastId;
    out.push(frame);
    dataLines = [];
    eventType = '';
  };

  const handleLine = (line: string, out: SseFrame[]): void => {
    if (line === '') return dispatch(out);
    // Comments are keepalives and carry nothing.
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        eventType = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) lastId = value;
        break;
      default:
        // Unknown fields, `retry:` included, are ignored per spec. This is what
        // lets the service add fields without breaking older clients.
        break;
    }
  };

  return {
    push(chunk: string): SseFrame[] {
      const out: SseFrame[] = [];
      buffer += chunk;

      // Hold back a trailing CR: it may be the first half of a CRLF split
      // across two reads, and splitting now would invent a blank line and
      // dispatch the frame early.
      let searchable = buffer;
      let heldCr = '';
      if (searchable.endsWith('\r')) {
        heldCr = '\r';
        searchable = searchable.slice(0, -1);
      }

      const lines = searchable.split(/\r\n|\r|\n/);
      // The final element is an incomplete line, so it stays buffered.
      buffer = (lines.pop() ?? '') + heldCr;

      for (const line of lines) handleLine(line, out);
      return out;
    },
  };
}

/** Reads a response body and yields frames as they complete. */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    for (;;) {
      const { done, value } = await reader.read();

      // Cancelling a reader ends the loop cleanly, which would look like a
      // finished answer. Aborting has to surface as an error so the caller can
      // tell "stopped" apart from "complete".
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;

      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        yield frame;
      }
    }
  } finally {
    // Runs when the consumer breaks out of its for-await too, so an abandoned
    // stream never leaks a reader.
    void reader.cancel().catch(() => undefined);
  }
}
