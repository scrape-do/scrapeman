import type { QueryParam } from '@scrapeman/shared-types';

/**
 * Convert a legacy key/value map into the ordered {@link QueryParam} list used
 * by `ScrapemanRequest.params`. All rows are enabled; a map has no notion of a
 * disabled row. Used by importers that collect params into a map first.
 */
export function queryParamsFromMap(map: Record<string, string>): QueryParam[] {
  return Object.entries(map).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));
}
