import type {
  ExecutedResponse,
  ScrapemanRequest,
} from '@scrapeman/shared-types';

export * from './executor.js';
export * from './errors.js';
export { UndiciExecutor, BODY_UI_LIMIT } from './adapters/undici-executor.js';
export type { UndiciExecutorOptions } from './adapters/undici-executor.js';
export * from './format/index.js';
export * from './workspace/index.js';
export * from './curl/index.js';
export * from './variables/index.js';
export * from './history/index.js';
export * from './codegen/index.js';
export * from './auth/index.js';
export * from './scrapeDo/index.js';
export * from './cookies/index.js';
export * from './load/index.js';
export * from './auto-headers.js';
export * from './ua-presets.js';
export * from './anti-bot.js';
export * from './sse-reader.js';
export * from './git/index.js';
export * from './import/index.js';
export { normalizeUrl } from './url/normalize.js';
// Note: WebSocketClient is exported here for main-process use only.
// The renderer must NOT import @scrapeman/http-core top-level — it drags undici in.
export { WebSocketClient } from './websocket/index.js';
export type { WebSocketClientOptions } from './websocket/index.js';
export * from './runner/index.js';
export * from './runner/report.js';
export * from './runner/csv-reader.js';

export type { ScrapemanRequest, ExecutedResponse };
