import { describe, expect, it } from 'vitest';
import { readSseStream } from '../src/sse-reader.js';

// Helper: wrap a sequence of string chunks as an async iterable of Uint8Array.
async function* chunks(parts: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  for (const p of parts) yield enc.encode(p);
}

describe('readSseStream', () => {
  it('parses a single event', async () => {
    const result = await readSseStream(chunks(['data: hello\n\n']));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.data).toBe('hello');
    expect(result.events[0]?.parsedData).toBeUndefined();
  });

  it('parses multiple events', async () => {
    const result = await readSseStream(
      chunks(['data: one\n\ndata: two\n\n']),
    );
    expect(result.events.map((e) => e.data)).toEqual(['one', 'two']);
  });

  it('handles split chunks mid-event', async () => {
    const result = await readSseStream(
      chunks(['data: hel', 'lo wo', 'rld\n\ndata: next\n\n']),
    );
    expect(result.events.map((e) => e.data)).toEqual([
      'hello world',
      'next',
    ]);
  });

  it('handles split chunks across the blank-line terminator', async () => {
    const result = await readSseStream(
      chunks(['data: a\n', '\ndata: b\n\n']),
    );
    expect(result.events.map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('parses JSON data into parsedData', async () => {
    const result = await readSseStream(
      chunks(['data: {"ok":true}\n\n']),
    );
    expect(result.events[0]?.data).toBe('{"ok":true}');
    expect(result.events[0]?.parsedData).toEqual({ ok: true });
  });

  it('leaves parsedData absent for non-JSON data', async () => {
    const result = await readSseStream(chunks(['data: plain text\n\n']));
    expect(result.events[0]?.data).toBe('plain text');
    expect(result.events[0]?.parsedData).toBeUndefined();
  });

  it('stops at [DONE] sentinel without emitting it', async () => {
    const result = await readSseStream(
      chunks([
        'data: first\n\ndata: second\n\ndata: [DONE]\n\ndata: never\n\n',
      ]),
    );
    expect(result.events.map((e) => e.data)).toEqual(['first', 'second']);
  });

  it('preserves custom event type', async () => {
    const result = await readSseStream(
      chunks(['event: ping\ndata: hi\n\n']),
    );
    expect(result.events[0]?.event).toBe('ping');
    expect(result.events[0]?.data).toBe('hi');
  });

  it('preserves id field', async () => {
    const result = await readSseStream(chunks(['id: 42\ndata: hi\n\n']));
    expect(result.events[0]?.id).toBe('42');
  });

  it('ignores SSE comment lines', async () => {
    const result = await readSseStream(
      chunks([':heartbeat\n\ndata: real\n\n']),
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.data).toBe('real');
  });

  it('joins multiple data lines with newline', async () => {
    const result = await readSseStream(
      chunks(['data: line1\ndata: line2\n\n']),
    );
    expect(result.events[0]?.data).toBe('line1\nline2');
  });

  it('parses retry as a number', async () => {
    const result = await readSseStream(
      chunks(['retry: 3000\ndata: x\n\n']),
    );
    expect(result.events[0]?.retry).toBe(3000);
  });

  it('handles CRLF line endings', async () => {
    const result = await readSseStream(
      chunks(['data: one\r\n\r\ndata: two\r\n\r\n']),
    );
    expect(result.events.map((e) => e.data)).toEqual(['one', 'two']);
  });

  it('records raw lines for debugging', async () => {
    const result = await readSseStream(
      chunks([':ping\n\ndata: hi\n\n']),
    );
    expect(result.rawLines).toContain(':ping');
    expect(result.rawLines).toContain('data: hi');
  });

  it('works with a web ReadableStream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: web\n\n'));
        controller.close();
      },
    });
    const result = await readSseStream(stream);
    expect(result.events[0]?.data).toBe('web');
  });
});
