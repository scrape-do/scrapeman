import { BrowserWindow, ipcMain } from 'electron';
import { WebSocketClient } from '@scrapeman/http-core';
import type { WsEvent } from '@scrapeman/shared-types';

// Live connections keyed by connectionId (assigned by the renderer).
const clients = new Map<string, WebSocketClient>();

function broadcast(payload: WsEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ws:event', payload);
  }
}

export function registerWebSocketHandlers(): void {
  ipcMain.handle(
    'ws:connect',
    async (
      _e,
      connectionId: string,
      url: string,
      options: {
        headers?: Record<string, string>;
        proxyUrl?: string;
        autoReconnect?: boolean;
        reconnectIntervalMs?: number;
        pingIntervalMs?: number;
      },
    ): Promise<void> => {
      // Tear down any existing client for this id before re-connecting.
      const existing = clients.get(connectionId);
      if (existing) {
        existing.disconnect(1000, 'replaced');
        clients.delete(connectionId);
      }

      const client = new WebSocketClient();

      client.on('message', (msg) => {
        broadcast({ connectionId, message: msg });
      });

      client.on('open', () => {
        broadcast({
          connectionId,
          message: {
            id: crypto.randomUUID(),
            direction: 'status',
            timestamp: Date.now(),
            data: 'OPEN',
          },
        });
      });

      client.on('close', (code: number, reason: string) => {
        broadcast({
          connectionId,
          message: {
            id: crypto.randomUUID(),
            direction: 'status',
            timestamp: Date.now(),
            data: `CLOSED (${code}${reason ? `: ${reason}` : ''})`,
          },
        });
        clients.delete(connectionId);
      });

      client.on('error', (err: Error) => {
        broadcast({
          connectionId,
          message: {
            id: crypto.randomUUID(),
            direction: 'status',
            timestamp: Date.now(),
            data: `ERROR: ${err.message}`,
          },
        });
      });

      client.on('ping', (msg) => {
        broadcast({ connectionId, message: msg });
      });

      client.on('pong', (msg) => {
        broadcast({ connectionId, message: msg });
      });

      clients.set(connectionId, client);
      await client.connect(url, options);
    },
  );

  ipcMain.handle('ws:send', async (_e, connectionId: string, data: string): Promise<void> => {
    const client = clients.get(connectionId);
    if (!client) throw new Error(`No WebSocket connection for id=${connectionId}`);
    client.send(data);
    // The send() call records the message in the client timeline and emits
    // 'message', but that event only reaches listeners registered above which
    // broadcast 'in' messages. Outbound messages are already broadcast from
    // within send(), but we only wire 'message' events, so outbound messages
    // sent via the client.send() path are already captured in the event above
    // because WebSocketClient.send() emits 'message' with direction='out'.
  });

  ipcMain.handle('ws:disconnect', async (_e, connectionId: string): Promise<void> => {
    const client = clients.get(connectionId);
    if (!client) return;
    client.disconnect(1000, 'user closed');
    clients.delete(connectionId);
  });
}

/** Clean up all live connections (call on window-all-closed / before-quit). */
export function disposeWebSocketClients(): void {
  for (const [, client] of clients) {
    try {
      client.disconnect(1001, 'app closing');
    } catch {
      // Best-effort cleanup.
    }
  }
  clients.clear();
}
