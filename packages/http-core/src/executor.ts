import type {
  ExecutedResponse,
  ScrapemanRequest,
} from '@scrapeman/shared-types';

export interface RequestExecutor {
  execute(
    request: ScrapemanRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ExecutedResponse>;
}
