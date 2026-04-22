import { EventEmitter } from 'node:events';
import { WebSocket, ProxyAgent } from 'undici';
import type { WsConnectionState, WsMessage } from '@scrapeman/shared-types';

export interface WebSocketClientOptions {
  /** Extra HTTP headers sent on the Upgrade request. */
  headers?: Record<string, string>;
  /** HTTP/HTTPS proxy URL (e.g. http://proxy:8080). Forwarded as undici dispatcher. */
  proxyUrl?: string;
  /** Reconnect automatically on unexpected close. */
  autoReconnect?: boolean;
  /** Delay between reconnect attempts in ms. Default 2000. */
  reconnectIntervalMs?: number;
  /** Interval for sending ping frames in ms. 0 = disabled. Default 30000. */
  pingIntervalMs?: number;
}

interface PendingPing {
  sentAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket client backed by undici's WebSocket implementation.
 *
 * - Emits 'message', 'open', 'close', 'error', 'ping', 'pong'.
 * - Records a full bidirectional message timeline accessible via getTimeline().
 * - Tracks ping/pong round-trip latency.
 * - Supports per-connection proxy via ProxyAgent.
 * - Optional auto-reconnect with configurable interval.
 * - Optional ping keep-alive with configurable interval.
 */
export class WebSocketClient extends EventEmitter {
  constructor() {
    super();
    // Prevent Node's EventEmitter default behavior of throwing when 'error'
    // is emitted with no listener. Callers who want error events subscribe via
    // client.on('error', handler). Without this, unhandled connection failures
    // (e.g. ECONNREFUSED) would crash the process.
    this.on('error', () => {
      // Default: swallow. Callers opt in by attaching their own listener.
    });
  }

  private ws: InstanceType<typeof WebSocket> | null = null;
  private state: WsConnectionState = 'CLOSED';
  private timeline: WsMessage[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPing: PendingPing | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private currentUrl = '';
  private currentOptions: WebSocketClientOptions = {};

  getState(): WsConnectionState {
    return this.state;
  }

  getTimeline(): WsMessage[] {
    return [...this.timeline];
  }

  /** Connect to a WebSocket URL. Resolves once the socket is OPEN or rejects on first error. */
  async connect(url: string, options: WebSocketClientOptions = {}): Promise<void> {
    if (this.state === 'OPEN' || this.state === 'CONNECTING') {
      throw new Error('WebSocketClient is already connecting or open');
    }

    this.stopped = false;
    this.currentUrl = url;
    this.currentOptions = options;
    this.timeline = [];

    return new Promise<void>((resolve, reject) => {
      this._open(url, options, resolve, reject);
    });
  }

  /** Send a text or binary message. */
  send(data: string | Uint8Array): void {
    if (!this.ws || this.state !== 'OPEN') {
      throw new Error('WebSocket is not open');
    }
    this.ws.send(data);
    const msg: WsMessage = {
      id: crypto.randomUUID(),
      direction: 'out',
      timestamp: Date.now(),
      data: typeof data === 'string' ? data : `[binary ${data.byteLength}B]`,
      isBinary: typeof data !== 'string',
    };
    this.timeline.push(msg);
    this.emit('message', msg);
  }

  /** Close the connection cleanly. */
  disconnect(code = 1000, reason = ''): void {
    this.stopped = true;
    this._clearTimers();
    if (this.ws && (this.state === 'OPEN' || this.state === 'CONNECTING')) {
      this._setState('CLOSING');
      this.ws.close(code, reason);
    }
  }

  // ---------------------------------------------------------------------- //
  // Private                                                                 //
  // ---------------------------------------------------------------------- //

  private _open(
    url: string,
    options: WebSocketClientOptions,
    onOpenCb: (() => void) | null,
    onErrorCb: ((err: Error) => void) | null,
  ): void {
    this._setState('CONNECTING');
    // Mutable refs so callbacks can be nulled out after the first call,
    // preventing double-resolve/reject if both error and close fire.
    let onOpen = onOpenCb;
    let onError = onErrorCb;

    const dispatcher = options.proxyUrl
      ? new ProxyAgent(options.proxyUrl)
      : undefined;

    let socket: InstanceType<typeof WebSocket>;
    try {
      socket = dispatcher
        ? new WebSocket(url, { dispatcher, ...(options.headers ? { headers: options.headers } : {}) })
        : new WebSocket(url, { ...(options.headers ? { headers: options.headers } : {}) });
    } catch (err) {
      this._setState('CLOSED');
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) onError(error);
      this.emit('error', error);
      return;
    }

    this.ws = socket;
    // Receive binary frames as ArrayBuffer so we can inspect byte length
    // without async Blob.arrayBuffer() calls.
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      this._setState('OPEN');
      const statusMsg: WsMessage = {
        id: crypto.randomUUID(),
        direction: 'status',
        timestamp: Date.now(),
        data: 'Connected',
      };
      this.timeline.push(statusMsg);
      this._startPing(options.pingIntervalMs ?? 30_000);
      if (onOpen) {
        onOpen();
        // Null out so reconnect callbacks don't accidentally re-call.
        onOpen = null;
        onError = null;
      }
      this.emit('open');
    });

    socket.addEventListener('message', (ev) => {
      const raw = ev.data;
      const isBinary = raw instanceof ArrayBuffer || ArrayBuffer.isView(raw);
      const displayData = isBinary
        ? `[binary ${(raw as ArrayBuffer).byteLength ?? (raw as ArrayBufferView).byteLength}B]`
        : String(raw);

      // Check if this message is a pong response to our ping
      if (!isBinary && typeof raw === 'string' && raw === '__ping__' && this.pendingPing) {
        this._handlePong();
        return;
      }

      const msg: WsMessage = {
        id: crypto.randomUUID(),
        direction: 'in',
        timestamp: Date.now(),
        data: displayData,
        isBinary,
      };
      this.timeline.push(msg);
      this.emit('message', msg);
    });

    socket.addEventListener('close', (ev) => {
      this._setState('CLOSED');
      this._clearTimers();
      const statusMsg: WsMessage = {
        id: crypto.randomUUID(),
        direction: 'status',
        timestamp: Date.now(),
        data: `Disconnected (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''})`,
      };
      this.timeline.push(statusMsg);
      if (onError) {
        // Open never fired — treat close as a connection error.
        onError(new Error(`WebSocket closed before open (code ${ev.code})`));
        onOpen = null;
        onError = null;
      }
      this.emit('close', ev.code, ev.reason);
      if (!this.stopped && options.autoReconnect) {
        this._scheduleReconnect(options);
      }
    });

    socket.addEventListener('error', (ev) => {
      // undici fires error then close; let close handle cleanup.
      const message =
        'message' in ev && typeof ev.message === 'string'
          ? ev.message
          : 'WebSocket error';
      const error = new Error(message);
      if (onError) {
        onError(error);
        onOpen = null;
        onError = null;
      }
      this.emit('error', error);
    });
  }

  private _setState(next: WsConnectionState): void {
    this.state = next;
  }

  private _startPing(intervalMs: number): void {
    if (intervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      if (this.state !== 'OPEN' || !this.ws) return;
      const sentAt = Date.now();

      // Application-level ping — send a sentinel message and wait for echo.
      // This is the only reliable cross-platform approach with undici's WS
      // which does not expose the raw ping frame API to userland.
      try {
        this.ws.send('__ping__');
      } catch {
        return;
      }

      // Timeout: if no pong in 10s, record a missed ping.
      const timeoutTimer = setTimeout(() => {
        if (this.pendingPing?.sentAt === sentAt) {
          this.pendingPing = null;
          const msg: WsMessage = {
            id: crypto.randomUUID(),
            direction: 'ping',
            timestamp: sentAt,
            data: 'ping (no response)',
          };
          this.timeline.push(msg);
          this.emit('ping', msg);
        }
      }, 10_000);

      this.pendingPing = { sentAt, timer: timeoutTimer };
    }, intervalMs);
  }

  private _handlePong(): void {
    if (!this.pendingPing) return;
    const latencyMs = Date.now() - this.pendingPing.sentAt;
    clearTimeout(this.pendingPing.timer);
    this.pendingPing = null;

    const msg: WsMessage = {
      id: crypto.randomUUID(),
      direction: 'pong',
      timestamp: Date.now(),
      latencyMs,
      data: `pong (${latencyMs}ms)`,
    };
    this.timeline.push(msg);
    this.emit('pong', msg);
  }

  private _scheduleReconnect(options: WebSocketClientOptions): void {
    const delay = options.reconnectIntervalMs ?? 2_000;
    const statusMsg: WsMessage = {
      id: crypto.randomUUID(),
      direction: 'status',
      timestamp: Date.now(),
      data: `Reconnecting in ${delay}ms…`,
    };
    this.timeline.push(statusMsg);
    this.reconnectTimer = setTimeout(() => {
      if (this.stopped) return;
      this._open(this.currentUrl, this.currentOptions, null, null);
    }, delay);
  }

  private _clearTimers(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pendingPing !== null) {
      clearTimeout(this.pendingPing.timer);
      this.pendingPing = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
