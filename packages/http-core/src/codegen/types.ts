import type { ScrapemanRequest } from '@scrapeman/shared-types';

export type CodegenTarget = 'curl' | 'fetch' | 'python' | 'go';

export interface CodegenOptions {
  /**
   * When true, `{{var}}` templates in URL/headers/body/auth are substituted
   * using the provided variables map before generation. When false the
   * templates are preserved as-is so the snippet stays portable.
   */
  inlineVariables: boolean;
  variables: Record<string, string>;
  /**
   * Variable keys whose values are secret. When inlineVariables is true,
   * these values are partially masked instead of shown in plain text.
   */
  secretKeys?: ReadonlySet<string>;
}

export interface Codegen {
  target: CodegenTarget;
  label: string;
  language: 'shell' | 'javascript' | 'python' | 'go';
  generate: (request: ScrapemanRequest, options: CodegenOptions) => string;
}
