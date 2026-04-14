import type { KeyValue, ScrapemanRequest } from '@scrapeman/shared-types';
import { resolveRequest } from '../variables/resolve.js';
import type { CodegenOptions } from './types.js';

export interface PreparedRequest {
  method: string;
  url: string;
  headers: KeyValue;
  body: string | null;
  bodyLooksJson: boolean;
}

/**
 * Applies variable substitution (if inlineVariables) and then normalizes
 * auth / body into the primitive shape each generator needs.
 */
export function prepareRequest(
  request: ScrapemanRequest,
  options: CodegenOptions,
): PreparedRequest {
  const resolved = options.inlineVariables
    ? resolveRequest(request, { variables: options.variables }).request
    : request;

  const headers: KeyValue = { ...(resolved.headers ?? {}) };

  // Apply params into URL query string if not already present.
  let url = resolved.url;
  if (resolved.params && Object.keys(resolved.params).length > 0) {
    const questionMark = url.includes('?');
    const pairs = Object.entries(resolved.params).map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    );
    url = url + (questionMark ? '&' : '?') + pairs.join('&');
  }

  // Auth: basic → Authorization header; bearer → Authorization header.
  if (resolved.auth) {
    if (resolved.auth.type === 'basic') {
      const token = Buffer.from(
        `${resolved.auth.username}:${resolved.auth.password}`,
        'utf8',
      ).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    } else if (resolved.auth.type === 'bearer') {
      headers['Authorization'] = `Bearer ${resolved.auth.token}`;
    } else if (resolved.auth.type === 'apiKey' && resolved.auth.in === 'header') {
      headers[resolved.auth.key] = resolved.auth.value;
    }
  }

  let body: string | null = null;
  let bodyLooksJson = false;
  if (resolved.body && resolved.body.type !== 'none') {
    if (
      resolved.body.type === 'json' ||
      resolved.body.type === 'xml' ||
      resolved.body.type === 'text' ||
      resolved.body.type === 'html' ||
      resolved.body.type === 'javascript'
    ) {
      body = resolved.body.content ?? '';
      bodyLooksJson = resolved.body.type === 'json';
      if (bodyLooksJson && !headerExists(headers, 'Content-Type')) {
        headers['Content-Type'] = 'application/json';
      }
    } else if (resolved.body.type === 'formUrlEncoded') {
      body = new URLSearchParams(resolved.body.fields).toString();
      if (!headerExists(headers, 'Content-Type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
  }

  return {
    method: resolved.method,
    url,
    headers,
    body,
    bodyLooksJson,
  };
}

function headerExists(headers: KeyValue, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}
