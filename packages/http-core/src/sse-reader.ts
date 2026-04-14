// SSE (Server-Sent Events) stream reader.
//
// Consumes a response body exactly once and buffers parsed events into an
// array. The same array is shared between the UI renderer and the script
// sandbox — callers must not re-read the underlying stream.
//
// Parsing follows the WHATWG SSE spec subset relevant for HTTP response
// inspection, plus one convention: a `data: [DONE]` line (common in
// OpenAI/LLM streams) terminates consumption without emitting an event.

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  parsedData?: unknown;
  retry?: number;
}

export interface SseResult {
  events: SseEvent[];
  rawLines: string[];
}

type AnyReadable =
  | ReadableStream<Uint8Array>
  | NodeJS.ReadableStream
  | AsyncIterable<Uint8Array | Buffer>;

export async function readSseStream(body: AnyReadable): Promise<SseResult> {
  const events: SseEvent[] = [];
  const rawLines: string[] = [];
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let done = false;

  // Process any complete blocks (delimited by blank line) in `buffer`,
  // leaving any trailing partial block behind for the next chunk.
  const flushBlocks = (): boolean => {
    // Normalize CRLF/CR to LF so the `\n\n` split is reliable.
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (true) {
      const idx = buffer.indexOf('\n\n');
      if (idx === -1) return false;
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const stop = handleBlock(block, events, rawLines);
      if (stop) return true;
    }
  };

  for await (const chunk of toAsyncIterable(body)) {
    const view =
      chunk instanceof Uint8Array
        ? chunk
        : typeof chunk === 'string'
          ? new TextEncoder().encode(chunk)
          : new Uint8Array(chunk as ArrayBufferLike);
    buffer += decoder.decode(view, { stream: true });
    if (flushBlocks()) {
      done = true;
      break;
    }
  }

  if (!done) {
    // Flush any residual bytes from the decoder.
    buffer += decoder.decode();
    // Treat any trailing non-empty content as a final block even if the
    // stream ended without a terminating blank line.
    if (buffer.length > 0) {
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      // Process any full blocks first.
      flushBlocks();
      if (buffer.trim().length > 0) {
        handleBlock(buffer, events, rawLines);
      }
      buffer = '';
    }
  }

  return { events, rawLines };
}

// Parses a single SSE block. Returns `true` when a `[DONE]` sentinel was
// seen and the caller should stop consuming the stream.
function handleBlock(
  block: string,
  events: SseEvent[],
  rawLines: string[],
): boolean {
  const lines = block.split('\n');
  const dataParts: string[] = [];
  let id: string | undefined;
  let eventType: string | undefined;
  let retry: number | undefined;
  let sawField = false;

  for (const line of lines) {
    rawLines.push(line);
    if (line.length === 0) continue;
    // SSE comment — ignored.
    if (line.startsWith(':')) continue;

    const colonIdx = line.indexOf(':');
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
    // Per spec, a single leading space after the colon is stripped.
    if (value.startsWith(' ')) value = value.slice(1);

    sawField = true;
    switch (field) {
      case 'id':
        id = value;
        break;
      case 'event':
        eventType = value;
        break;
      case 'data':
        dataParts.push(value);
        break;
      case 'retry': {
        const n = Number(value);
        if (Number.isFinite(n)) retry = n;
        break;
      }
      default:
        // Unknown field — ignore per spec.
        break;
    }
  }

  if (!sawField) return false;

  const data = dataParts.join('\n');

  // `[DONE]` sentinel — do not emit, stop consumption.
  if (data === '[DONE]') return true;

  // Only emit if there was at least a `data:` line; spec says blocks with
  // no data field should not dispatch an event.
  if (dataParts.length === 0) return false;

  const evt: SseEvent = { data };
  if (id !== undefined) evt.id = id;
  if (eventType !== undefined) evt.event = eventType;
  if (retry !== undefined) evt.retry = retry;

  const parsed = tryParseJson(data);
  if (parsed.ok) evt.parsedData = parsed.value;

  events.push(evt);
  return false;
}

function tryParseJson(
  input: string,
): { ok: true; value: unknown } | { ok: false } {
  // Cheap gate — avoid throwing on obviously non-JSON payloads.
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false };
  const first = trimmed[0];
  if (
    first !== '{' &&
    first !== '[' &&
    first !== '"' &&
    first !== '-' &&
    first !== 't' &&
    first !== 'f' &&
    first !== 'n' &&
    !(first !== undefined && first >= '0' && first <= '9')
  ) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

async function* toAsyncIterable(body: AnyReadable): AsyncIterable<Uint8Array> {
  // Web ReadableStream branch.
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  // Node stream / async iterable branch.
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
    yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  }
}
