import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store.js';
import { JsonTree } from './JsonTree.js';
import type { WsMessage } from '@scrapeman/shared-types';

/** Direction indicator for a timeline message. */
function DirectionBadge({ direction }: { direction: WsMessage['direction'] }): JSX.Element {
  switch (direction) {
    case 'in':
      return <span className="text-green-400 font-mono text-[10px] select-none w-5 shrink-0">↓</span>;
    case 'out':
      return <span className="text-blue-400 font-mono text-[10px] select-none w-5 shrink-0">↑</span>;
    case 'ping':
      return <span className="text-ink-4 font-mono text-[10px] select-none w-5 shrink-0">●</span>;
    case 'pong':
      return <span className="text-ink-4 font-mono text-[10px] select-none w-5 shrink-0">○</span>;
    case 'status':
      return <span className="text-ink-4 font-mono text-[10px] select-none w-5 shrink-0">—</span>;
  }
}

function tryParseJson(data: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = data.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function TimelineItem({ msg }: { msg: WsMessage }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const parsed = msg.direction !== 'status' && msg.direction !== 'ping' && msg.direction !== 'pong'
    ? tryParseJson(msg.data)
    : { ok: false as const };

  return (
    <div className="flex gap-2 border-b border-line px-4 py-1.5 text-xs group">
      <DirectionBadge direction={msg.direction} />
      <span className="shrink-0 font-mono text-ink-4 w-16">
        {formatTimestamp(msg.timestamp)}
      </span>
      <div className="flex-1 min-w-0">
        {parsed.ok ? (
          <div>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-left text-ink-2 hover:text-ink-1 font-mono truncate w-full"
            >
              {expanded ? '' : msg.data.length > 120 ? msg.data.slice(0, 120) + '…' : msg.data}
            </button>
            {expanded && (
              <div className="mt-1 rounded bg-bg-muted p-2">
                <JsonTree value={parsed.value} />
              </div>
            )}
          </div>
        ) : (
          <span
            className={`font-mono break-all ${
              msg.direction === 'status' ? 'text-ink-4 italic' : 'text-ink-2'
            }`}
          >
            {msg.data}
          </span>
        )}
        {msg.latencyMs !== undefined && (
          <span className="ml-1 text-ink-4">({msg.latencyMs}ms)</span>
        )}
      </div>
    </div>
  );
}

function ConnectionStateDot({ state }: { state: string }): JSX.Element {
  let color = 'bg-ink-4';
  if (state === 'OPEN') color = 'bg-green-400';
  else if (state === 'CONNECTING' || state === 'CLOSING') color = 'bg-yellow-400';
  else if (state === 'CLOSED') color = 'bg-red-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color} shrink-0`} />;
}

/**
 * WebSocket panel rendered as a builder pane.
 * Full connection lifecycle: connect, send, receive, disconnect.
 * Timeline auto-scrolls unless the user has manually scrolled up.
 */
export function WebSocketPanel({ tabId }: { tabId: string }): JSX.Element {
  const wsState = useAppStore((s) => s.tabs.find((t) => t.id === tabId)?.websocket);
  const wsConnect = useAppStore((s) => s.wsConnect);
  const wsSend = useAppStore((s) => s.wsSend);
  const wsDisconnect = useAppStore((s) => s.wsDisconnect);
  const wsSetUrl = useAppStore((s) => s.wsSetUrl);
  const wsSetSendDraft = useAppStore((s) => s.wsSetSendDraft);

  // Local URL input for when wsState is not yet initialized.
  const [localUrl, setLocalUrl] = useState('');
  const url = wsState?.url ?? localUrl;
  const state = wsState?.state ?? 'CLOSED';
  const timeline = wsState?.timeline ?? [];
  const sendDraft = wsState?.sendDraft ?? '';
  const connecting = wsState?.connecting ?? false;

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll when new messages arrive and autoScroll is on.
  useEffect(() => {
    if (!autoScroll) return;
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length, autoScroll]);

  const handleScroll = useCallback((): void => {
    const el = timelineRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const handleConnect = useCallback((): void => {
    const target = wsState?.url ?? localUrl;
    if (!target.trim()) return;
    if (!wsState) {
      wsSetUrl(tabId, target);
    }
    void wsConnect(tabId, target);
  }, [wsState, localUrl, tabId, wsConnect, wsSetUrl]);

  const handleDisconnect = useCallback((): void => {
    void wsDisconnect(tabId);
  }, [tabId, wsDisconnect]);

  const handleSend = useCallback((): void => {
    if (!sendDraft.trim()) return;
    void wsSend(tabId, sendDraft);
    wsSetSendDraft(tabId, '');
  }, [sendDraft, tabId, wsSend, wsSetSendDraft]);

  const handleSendKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleExport = useCallback((): void => {
    const json = JSON.stringify(timeline, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'ws-timeline.json';
    a.click();
    URL.revokeObjectURL(href);
  }, [timeline]);

  const isOpen = state === 'OPEN';
  const isConnecting = state === 'CONNECTING' || connecting;
  const canConnect = !isOpen && !isConnecting && url.trim().length > 0;
  const canSend = isOpen && sendDraft.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar: URL + Connect/Disconnect */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <ConnectionStateDot state={state} />
        <input
          type="text"
          value={url}
          onChange={(e) => {
            const v = e.target.value;
            if (wsState) {
              wsSetUrl(tabId, v);
            } else {
              setLocalUrl(v);
            }
          }}
          placeholder="wss://echo.websocket.org"
          disabled={isOpen || isConnecting}
          className="flex-1 rounded border border-line bg-bg-input px-3 py-1.5 text-sm font-mono text-ink-1 placeholder:text-ink-4 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canConnect) handleConnect();
          }}
        />
        {isOpen ? (
          <button onClick={handleDisconnect} className="btn-secondary min-w-[100px]">
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={!canConnect}
            className="btn-primary min-w-[100px]"
          >
            {isConnecting ? (
              <span className="flex items-center gap-1.5">
                <span className="spinner" aria-hidden="true" />
                Connecting
              </span>
            ) : (
              'Connect'
            )}
          </button>
        )}
      </div>

      {/* Error banner */}
      {wsState?.error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-950/20 border-b border-line">
          {wsState.error}
        </div>
      )}

      {/* Timeline */}
      <div className="flex items-center justify-between px-4 py-1 border-b border-line">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
          Timeline
          {timeline.length > 0 && (
            <span className="ml-1.5 rounded-full bg-bg-muted px-1.5 text-[10px] font-semibold text-ink-3">
              {timeline.length}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll((v) => !v)}
            title="Toggle auto-scroll"
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              autoScroll
                ? 'bg-accent-soft text-accent'
                : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
            }`}
          >
            Auto-scroll
          </button>
          {timeline.length > 0 && (
            <button
              onClick={handleExport}
              title="Export timeline as JSON"
              className="rounded px-2 py-0.5 text-[10px] font-medium text-ink-3 hover:bg-bg-hover hover:text-ink-1"
            >
              Export
            </button>
          )}
        </div>
      </div>

      <div
        ref={timelineRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {timeline.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-ink-4">
            {isOpen ? 'No messages yet.' : 'Connect to start.'}
          </div>
        ) : (
          timeline.map((msg) => <TimelineItem key={msg.id} msg={msg} />)
        )}
      </div>

      {/* Send area */}
      <div className="border-t border-line p-3 flex gap-2 items-end">
        <textarea
          value={sendDraft}
          onChange={(e) => wsSetSendDraft(tabId, e.target.value)}
          onKeyDown={handleSendKeyDown}
          placeholder={'Message payload  (⌘↵ to send)'}
          disabled={!isOpen}
          rows={3}
          className="flex-1 resize-none rounded border border-line bg-bg-input px-3 py-2 text-xs font-mono text-ink-1 placeholder:text-ink-4 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="btn-primary shrink-0"
          title="Send message (⌘↵)"
        >
          Send
        </button>
      </div>
    </div>
  );
}
