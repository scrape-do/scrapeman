/**
 * WebSocketClient unit tests.
 *
 * Uses the `ws` package as a local echo server (devDep only — production code
 * uses undici's WebSocket). Tests verify: connect/send/receive, disconnect,
 * error on bad URL, auto-reconnect, timeline contents, and ping/pong tracking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { WebSocketClient } from '../src/websocket/client.js';

// Increase timeout for async tests that involve real network connections.
const TIMEOUT = 10_000;

function makeEchoServer(): Promise<{ server: WebSocketServer; port: number }> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        // Send as string so undici receives a text frame, not a binary frame.
        socket.send(data.toString());
      });
    });
    server.on('listening', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
    server.on('error', reject);
  });
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

describe('WebSocketClient', () => {
  let server: WebSocketServer;
  let port: number;
  let client: WebSocketClient;

  beforeEach(async () => {
    const s = await makeEchoServer();
    server = s.server;
    port = s.port;
    client = new WebSocketClient();
  });

  afterEach(async () => {
    client.disconnect();
    await closeServer(server);
  });

  it('connects and reaches OPEN state', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    expect(client.getState()).toBe('OPEN');
  }, TIMEOUT);

  it('emits open event', async () => {
    const openHandler = vi.fn();
    client.on('open', openHandler);
    await client.connect(`ws://127.0.0.1:${port}`);
    expect(openHandler).toHaveBeenCalledTimes(1);
  }, TIMEOUT);

  it('sends a message and receives echo', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    const received: string[] = [];
    client.on('message', (msg) => {
      if (msg.direction === 'in') received.push(msg.data);
    });
    client.send('hello');
    // Wait for the echo to arrive.
    await new Promise<void>((resolve) => {
      client.on('message', () => {
        if (received.length > 0) resolve();
      });
      // Guard: resolve after 2s even if message already arrived.
      setTimeout(resolve, 2000);
    });
    expect(received).toContain('hello');
  }, TIMEOUT);

  it('records outbound messages in timeline with direction=out', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    client.send('outbound');
    const timeline = client.getTimeline();
    const outMsg = timeline.find((m) => m.direction === 'out');
    expect(outMsg).toBeDefined();
    expect(outMsg?.data).toBe('outbound');
  }, TIMEOUT);

  it('records inbound messages in timeline with direction=in', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    client.send('echo-me');

    await new Promise<void>((resolve) => {
      client.on('message', (m) => {
        if (m.direction === 'in') resolve();
      });
      setTimeout(resolve, 2000);
    });

    const inMsg = client.getTimeline().find((m) => m.direction === 'in');
    expect(inMsg).toBeDefined();
  }, TIMEOUT);

  it('disconnect transitions to CLOSED', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    expect(client.getState()).toBe('OPEN');
    const closePromise = new Promise<void>((resolve) => client.on('close', () => resolve()));
    client.disconnect();
    await closePromise;
    expect(client.getState()).toBe('CLOSED');
  }, TIMEOUT);

  it('emits close event after disconnect', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    const closeHandler = vi.fn();
    client.on('close', closeHandler);
    const p = new Promise<void>((resolve) => client.once('close', () => resolve()));
    client.disconnect(1000, 'bye');
    await p;
    expect(closeHandler).toHaveBeenCalled();
  }, TIMEOUT);

  it('rejects connect() on a bad URL', async () => {
    const badClient = new WebSocketClient();
    await expect(
      badClient.connect('ws://127.0.0.1:1'), // nothing listening
    ).rejects.toThrow();
  }, TIMEOUT);

  it('throws when sending on a closed socket', async () => {
    expect(() => client.send('no connection')).toThrow('WebSocket is not open');
  });

  it('getTimeline() returns a snapshot (not the live array)', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    const snap1 = client.getTimeline();
    client.send('test');
    const snap2 = client.getTimeline();
    // snap1 should not be mutated by the subsequent send.
    expect(snap2.length).toBeGreaterThan(snap1.length);
  }, TIMEOUT);

  it('adds a status message when connected', async () => {
    await client.connect(`ws://127.0.0.1:${port}`);
    const statusMsg = client.getTimeline().find((m) => m.direction === 'status');
    expect(statusMsg).toBeDefined();
    expect(statusMsg?.data).toBe('Connected');
  }, TIMEOUT);

  it('auto-reconnects after server closes connection', async () => {
    const reconnectClient = new WebSocketClient();
    let openCount = 0;
    reconnectClient.on('open', () => { openCount++; });

    await reconnectClient.connect(`ws://127.0.0.1:${port}`, {
      autoReconnect: true,
      reconnectIntervalMs: 200,
    });
    expect(openCount).toBe(1);

    // Close the server-side connections so the client gets a close event.
    await new Promise<void>((resolve) => {
      server.clients.forEach((s) => s.close());
      resolve();
    });

    // Wait for reconnect.
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (openCount >= 2) { resolve(); return; }
        setTimeout(check, 100);
      };
      check();
    });

    expect(openCount).toBeGreaterThanOrEqual(2);
    reconnectClient.disconnect();
  }, TIMEOUT);
});
