import type { ScrapeDoConfig, ScrapemanRequest } from '@scrapeman/shared-types';

const SCRAPE_DO_BASE = 'https://api.scrape.do/';

/**
 * Rewrites a request to go through api.scrape.do. The original target URL
 * (with its existing params merged in) becomes the `url` query parameter,
 * and the scrape-do options become sibling query parameters.
 *
 * Returns the request unchanged when scrapeDo is missing or disabled.
 */
export function composeScrapeDoRequest(
  request: ScrapemanRequest,
): ScrapemanRequest {
  if (!request.scrapeDo || !request.scrapeDo.enabled) return request;

  // request.url already carries every enabled param (the URL bar is the
  // single source of truth for the outgoing URL — see buildUrl). Do NOT
  // re-append request.params here; that duplicated keys the user had
  // already placed in the URL, which the scrape.do API rejects with
  // "Wrong query parameter. You are sending multiple value via same
  // parameter('token')".
  const targetUrl = request.url;
  const out = new URL(SCRAPE_DO_BASE);
  out.searchParams.set('token', request.scrapeDo.token);
  out.searchParams.set('url', targetUrl);

  appendBoolean(out, 'render', request.scrapeDo.render);
  appendBoolean(out, 'super', request.scrapeDo.super);
  appendBoolean(out, 'customHeaders', request.scrapeDo.customHeaders);
  if (request.scrapeDo.geoCode) out.searchParams.set('geoCode', request.scrapeDo.geoCode);
  if (request.scrapeDo.waitUntil)
    out.searchParams.set('waitUntil', request.scrapeDo.waitUntil);

  // The composed request hits api.scrape.do directly. Strip request.params so
  // the executor doesn't double-append; URL already contains everything.
  // Also strip request.scrapeDo so a downstream re-compose is a no-op.
  const composed: ScrapemanRequest = {
    ...request,
    url: out.toString(),
  };
  delete (composed as { params?: unknown }).params;
  delete (composed as { scrapeDo?: ScrapeDoConfig }).scrapeDo;
  return composed;
}

function appendBoolean(url: URL, key: string, value: boolean | undefined): void {
  if (value === true) url.searchParams.set(key, 'true');
}
