/**
 * Minimal Server-Sent Events reader.
 *
 * `EventSource` cannot be used here: it only issues GET requests and cannot
 * carry a JSON body or an Authorization header. So we read the response body
 * ourselves and split it into frames.
 */

export interface SseFrame {
  event: string;
  data: string;
}

const FRAME_SEPARATOR = /\r?\n\r?\n/;

/** Yields one frame per `event:`/`data:` block in the response body. */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    while (true) {
      const { done, value } = await reader.read();

      // Cancelling the reader ends the read loop cleanly, which would look
      // like a finished answer. Aborting has to surface as an error so the
      // caller can tell "stopped" apart from "complete".
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // A frame ends at a blank line. Anything after the last one is a
      // partial frame and stays in the buffer for the next read.
      const blocks = buffer.split(FRAME_SEPARATOR);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const frame = parseFrame(block);
        if (frame) yield frame;
      }
    }

    const trailing = parseFrame(buffer);
    if (trailing) yield trailing;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

function parseFrame(block: string): SseFrame | null {
  const trimmed = block.trim();
  if (!trimmed) return null;

  let event = 'message';
  const dataLines: string[] = [];

  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
