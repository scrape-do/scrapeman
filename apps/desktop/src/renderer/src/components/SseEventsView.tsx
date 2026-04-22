// SSE event list view.
//
// Renders a list of SseEvent objects that were collected after an
// `text/event-stream` response completed. If `data` is pre-parsed JSON
// (parsedData is set by the reader) it is shown through JsonTree; otherwise
// raw monospace text.
//
// This is Option A (post-completion): events come from
// ExecutedResponse.sseEvents after execution.status === 'success'. A live
// streaming view (Option B — incremental IPC events) is deferred.

import { useEffect, useRef, useState } from 'react';
import type { SseEvent } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { JsonTree } from './JsonTree.js';

// Base64-encode a UTF-8 string safely for IPC transport.
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}

interface SseEventsViewProps {
  events: SseEvent[];
  // True while execution.status === 'sending' so the header strip can show
  // the streaming indicator. With Option A this is always false by the time
  // the view is mounted — kept here so Option B can pass true without
  // changing the component signature.
  streaming: boolean;
  durationMs: number;
  requestId?: string;
}

export function SseEventsView({
  events,
  streaming,
  durationMs,
  requestId,
}: SseEventsViewProps): JSX.Element {
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new events arrive (while autoScroll is on).
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length, autoScroll]);

  // Pause auto-scroll when user scrolls up.
  const handleScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (!atBottom && autoScroll) setAutoScroll(false);
    if (atBottom && !autoScroll) setAutoScroll(true);
  };

  const handleExport = (): void => {
    const json = JSON.stringify(events, null, 2);
    const base64 = utf8ToBase64(json);
    void bridge.saveResponse(base64, 'sse-events.json');
  };

  const handleCancel = (): void => {
    if (requestId) void bridge.cancelRequest(requestId);
  };

  const totalBytes = events.reduce((acc, e) => acc + e.data.length, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header strip */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-bg-canvas px-4">
        {streaming ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-status-ok">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok animate-pulse" />
            Streaming
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-ink-3">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-3" />
            Finished
          </span>
        )}

        <span className="font-mono text-[11px] text-ink-2">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>

        <span className="font-mono text-[11px] text-ink-4">
          {formatBytes(totalBytes)}
        </span>

        {durationMs > 0 && (
          <span className="font-mono text-[11px] text-ink-4">
            {Math.round(durationMs)} ms
          </span>
        )}

        {streaming && (
          <button
            onClick={handleCancel}
            className="ml-1 rounded px-2 py-0.5 text-[11px] font-medium text-method-delete hover:bg-method-delete/10"
          >
            Stop
          </button>
        )}

        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            autoScroll
              ? 'bg-accent-soft text-accent'
              : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
          }`}
          title={autoScroll ? 'Auto-scroll on — click to pause' : 'Auto-scroll off — click to resume'}
        >
          {autoScroll ? 'Scroll: on' : 'Scroll: off'}
        </button>

        <button
          onClick={handleExport}
          disabled={events.length === 0}
          className="ml-auto rounded px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-bg-hover hover:text-ink-1 disabled:opacity-40"
          title="Export events as JSON"
        >
          Export JSON
        </button>
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-ink-4">
          {streaming ? 'Waiting for events...' : 'No events received.'}
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto px-4 py-2"
        >
          {events.map((evt, i) => (
            <EventBlock key={i} event={evt} index={i} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ─── EventBlock ──────────────────────────────────────────────────────────────

function EventBlock({
  event,
  index,
}: {
  event: SseEvent;
  index: number;
}): JSX.Element {
  return (
    <div className="mb-2 rounded border border-line bg-bg-subtle">
      {/* Event header row */}
      <div className="flex items-center gap-3 border-b border-line-subtle px-3 py-1.5">
        <span className="font-mono text-[10px] text-ink-4">#{index + 1}</span>
        {event.id !== undefined && (
          <FieldPill label="id" value={event.id} />
        )}
        {event.event !== undefined && (
          <FieldPill label="event" value={event.event} />
        )}
        {event.retry !== undefined && (
          <FieldPill label="retry" value={String(event.retry)} />
        )}
      </div>

      {/* Data body */}
      <div className="px-3 py-2">
        {event.parsedData !== undefined ? (
          <JsonTree value={event.parsedData} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-[18px] text-ink-1">
            {event.data}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── FieldPill ───────────────────────────────────────────────────────────────

function FieldPill({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1 font-mono text-[10px]">
      <span className="text-ink-4">{label}:</span>
      <span className="text-ink-2">{value}</span>
    </span>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
