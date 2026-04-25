import type { ScrapemanRequest, ExecutedResponse, Environment } from '@scrapeman/shared-types';

/**
 * Callbacks injected by the main process so the bru API can read/write
 * environment and collection files without the sandbox needing direct FS access.
 */
export interface BruCallbacks {
  /** Read the active environment variables as a flat key→value map. */
  getEnvVars: () => Promise<Record<string, string>>;
  /** Write one variable in the active environment. */
  setEnvVar: (name: string, value: string) => Promise<void>;
  /** Get all collection-level variables (collection.yaml). */
  getCollectionVars: () => Promise<Record<string, string>>;
  /** Set a collection-level variable. */
  setCollectionVar: (name: string, value: string) => Promise<void>;
  /** Get all global variables (globals.yaml). */
  getGlobalVars: () => Promise<Record<string, string>>;
  /** Set a global variable. */
  setGlobalVar: (name: string, value: string) => Promise<void>;
  /** Execute a sub-request. Returns a simplified response object. */
  sendRequest: (opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; headers: Record<string, string>; body: string | unknown }>;
}

export interface ReqProxy {
  url: string;
  method: string;
  getHeader: (key: string) => string | undefined;
  setHeader: (key: string, value: string) => void;
  getBody: () => string | undefined;
  setBody: (value: string) => void;
}

export interface ResProxy {
  getStatus: () => number;
  getHeader: (key: string) => string | undefined;
  getHeaders: () => Record<string, string>;
  getBody: () => string | unknown;
}

/**
 * Builds the mutable `req` proxy object for pre-request scripts.
 * Mutations are written to the `mutatedRequest` object that the caller
 * owns — the executor reads it back after the script finishes.
 */
export function buildReqProxy(
  request: ScrapemanRequest,
  mutatedRequest: MutableRequest,
): ReqProxy {
  return {
    get url() {
      return mutatedRequest.url;
    },
    get method() {
      return mutatedRequest.method;
    },
    getHeader(key: string) {
      const lower = key.toLowerCase();
      const entries = Object.entries(mutatedRequest.headers ?? {});
      return entries.find(([k]) => k.toLowerCase() === lower)?.[1];
    },
    setHeader(key: string, value: string) {
      mutatedRequest.headers = {
        ...(mutatedRequest.headers ?? {}),
        [key]: value,
      };
    },
    getBody() {
      const body = mutatedRequest.body;
      if (!body || body.type === 'none') return undefined;
      if (
        body.type === 'json' ||
        body.type === 'text' ||
        body.type === 'xml' ||
        body.type === 'html' ||
        body.type === 'javascript'
      ) {
        return body.content;
      }
      return undefined;
    },
    setBody(value: string) {
      const body = mutatedRequest.body;
      if (
        body &&
        body.type !== 'none' &&
        body.type !== 'formUrlEncoded' &&
        body.type !== 'multipart' &&
        body.type !== 'binary'
      ) {
        mutatedRequest.body = { ...body, content: value };
      } else {
        // Default to text if no body was set.
        mutatedRequest.body = { type: 'text', content: value };
      }
    },
  };
}

/**
 * Builds the read-only `res` proxy for post-response scripts.
 */
export function buildResProxy(response: ExecutedResponse): ResProxy {
  const headerMap: Record<string, string> = {};
  for (const [key, value] of response.headers) {
    headerMap[key.toLowerCase()] = value;
  }

  // Decode the body text once.
  let decodedText: string;
  try {
    decodedText = Buffer.from(response.bodyBase64, 'base64').toString('utf8');
  } catch {
    decodedText = '';
  }

  // Auto-parse JSON body when content-type indicates it.
  const contentType = (response.contentType ?? headerMap['content-type'] ?? '').toLowerCase();
  const isJson = contentType.includes('json');

  let parsedBody: string | unknown = decodedText;
  if (isJson && decodedText) {
    try {
      parsedBody = JSON.parse(decodedText);
    } catch {
      parsedBody = decodedText;
    }
  }

  return {
    getStatus: () => response.status,
    getHeader: (key: string) => headerMap[key.toLowerCase()],
    getHeaders: () => ({ ...headerMap }),
    getBody: () => parsedBody,
  };
}

/**
 * Builds the `bru` object exposed to all scripts (pre and post).
 *
 * Request-scoped vars (getVar/setVar) are stored on the `requestVars` map
 * that callers pass in; it is cleared after each request lifecycle.
 */
export function buildBruObject(
  requestVars: Map<string, string>,
  callbacks: BruCallbacks,
) {
  return {
    // ── Request-scoped variables ────────────────────────────────────────── //
    getVar(name: string): string | undefined {
      return requestVars.get(name);
    },
    setVar(name: string, value: string): void {
      requestVars.set(name, value);
    },

    // ── Environment variables ───────────────────────────────────────────── //
    getEnvVar: async (name: string): Promise<string | undefined> => {
      const vars = await callbacks.getEnvVars();
      return vars[name];
    },
    setEnvVar: async (name: string, value: string): Promise<void> => {
      await callbacks.setEnvVar(name, value);
    },

    // ── Collection variables ────────────────────────────────────────────── //
    getCollectionVar: async (name: string): Promise<string | undefined> => {
      const vars = await callbacks.getCollectionVars();
      return vars[name];
    },
    setCollectionVar: async (name: string, value: string): Promise<void> => {
      await callbacks.setCollectionVar(name, value);
    },

    // ── Global variables ────────────────────────────────────────────────── //
    getGlobalVar: async (name: string): Promise<string | undefined> => {
      const vars = await callbacks.getGlobalVars();
      return vars[name];
    },
    setGlobalVar: async (name: string, value: string): Promise<void> => {
      await callbacks.setGlobalVar(name, value);
    },

    // ── Sub-request ─────────────────────────────────────────────────────── //
    sendRequest: (opts: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: string;
    }) => callbacks.sendRequest(opts),

    // ── Built-in helpers (same values as {{random}} / {{timestamp}}) ─────── //
    random(): string {
      return Math.random().toString(36).slice(2);
    },
    timestamp(): number {
      return Date.now();
    },
    isoDate(): string {
      return new Date().toISOString();
    },
    randomInt(min = 0, max = 1_000_000): number {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
  };
}

/**
 * A partial, mutable view of `ScrapemanRequest` for pre-request script mutation.
 * The executor writes these fields back to the resolved request after the script.
 */
export interface MutableRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: ScrapemanRequest['body'];
}
