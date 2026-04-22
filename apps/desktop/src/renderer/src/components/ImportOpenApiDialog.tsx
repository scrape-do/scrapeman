import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { ImportResult } from '@scrapeman/shared-types';
import { bridge } from '../bridge.js';
import { useAppStore } from '../store.js';

type InputMode = 'url' | 'text';

interface Preview {
  totalRequests: number;
  totalFolders: number;
  tags: string[];
  authTypes: string[];
  envName: string;
  envVarCount: number;
  result: ImportResult;
}

function buildPreview(result: ImportResult): Preview {
  let totalRequests = result.requests.length;
  const tags: string[] = [];

  const walkFolder = (folder: ImportResult['folders'][number]): void => {
    tags.push(folder.name);
    totalRequests += folder.requests.length;
    for (const sub of folder.folders) {
      walkFolder(sub);
    }
  };
  for (const f of result.folders) {
    walkFolder(f);
  }

  const authTypes = new Set<string>();
  const collectAuth = (reqs: ImportResult['requests']): void => {
    for (const r of reqs) {
      if (r.auth && r.auth.type !== 'none') {
        authTypes.add(r.auth.type);
      }
    }
  };
  collectAuth(result.requests);
  for (const f of result.folders) {
    collectAuth(f.requests);
  }

  const env = result.environments[0];
  return {
    totalRequests,
    totalFolders: result.folders.length,
    tags,
    authTypes: [...authTypes],
    envName: env?.name ?? 'Imported API',
    envVarCount: env?.variables.length ?? 0,
    result,
  };
}

export function ImportOpenApiDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const workspace = useAppStore((s) => s.workspace);
  const refreshTree = useAppStore((s) => s.refreshTree);

  const [mode, setMode] = useState<InputMode>('url');
  const [urlValue, setUrlValue] = useState('');
  const [textValue, setTextValue] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);

  const urlRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setMode('url');
      setUrlValue('');
      setTextValue('');
      setPreview(null);
      setWarnings([]);
      setError(null);
      setLoading(false);
      setImporting(false);
      setImported(false);
    }
  }, [open]);

  const applyParseResult = (result: ImportResult): void => {
    if (
      result.warnings.length > 0 &&
      result.requests.length === 0 &&
      result.folders.length === 0
    ) {
      setError(result.warnings[0] ?? 'Parse failed');
      setPreview(null);
      return;
    }
    setWarnings(result.warnings);
    setError(null);
    setPreview(buildPreview(result));
  };

  const handleFetchUrl = async (): Promise<void> => {
    if (!urlValue.trim() || loading) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const fetchResult = await bridge.fetchOpenApiSpec(urlValue.trim());
      if (!fetchResult.ok) {
        setError(`Fetch failed: ${fetchResult.message}`);
        return;
      }
      const parseResult = await bridge.parseOpenApiSpec(fetchResult.text);
      if (!parseResult.ok) {
        setError(`Parse failed: ${parseResult.message}`);
        return;
      }
      applyParseResult(parseResult.result);
    } finally {
      setLoading(false);
    }
  };

  const handleParseText = async (): Promise<void> => {
    if (!textValue.trim()) return;
    setError(null);
    setPreview(null);
    const parseResult = await bridge.parseOpenApiSpec(textValue.trim());
    if (!parseResult.ok) {
      setError(`Parse failed: ${parseResult.message}`);
      return;
    }
    applyParseResult(parseResult.result);
  };

  const handleImport = async (): Promise<void> => {
    if (!preview || !workspace || importing) return;
    setImporting(true);
    setError(null);

    try {
      const { result } = preview;

      // Write the generated environment(s).
      for (const env of result.environments) {
        await bridge.envWrite(workspace.path, env);
      }

      // Write folders and requests recursively.
      const writeFolder = async (
        folder: ImportResult['folders'][number],
        parentRelPath: string,
      ): Promise<void> => {
        const folderRelPath = await bridge.workspaceCreateFolder(
          workspace.path,
          parentRelPath,
          folder.name,
        );
        for (const req of folder.requests) {
          const reqRelPath = await bridge.workspaceCreateRequest(
            workspace.path,
            folderRelPath,
            req.meta.name,
          );
          await bridge.workspaceWriteRequest(workspace.path, reqRelPath, req);
        }
        for (const sub of folder.folders) {
          await writeFolder(sub, folderRelPath);
        }
      };

      for (const folder of result.folders) {
        await writeFolder(folder, '');
      }
      for (const req of result.requests) {
        const reqRelPath = await bridge.workspaceCreateRequest(
          workspace.path,
          '',
          req.meta.name,
        );
        await bridge.workspaceWriteRequest(workspace.path, reqRelPath, req);
      }

      await refreshTree();
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-1/20 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[680px] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg-canvas p-5 shadow-popover animate-slide-down-fade flex flex-col">
          <RadixDialog.Title className="text-sm font-semibold text-ink-1">
            Import OpenAPI / Swagger
          </RadixDialog.Title>
          <RadixDialog.Description className="mt-1 text-xs text-ink-3">
            Supports OpenAPI 3.0.x, 3.1.x, and Swagger 2.0. JSON or YAML.
          </RadixDialog.Description>

          {/* Mode tabs */}
          <div className="mt-4 flex gap-0 border-b border-line">
            {(['url', 'text'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 pb-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  mode === m
                    ? 'border-accent text-ink-1'
                    : 'border-transparent text-ink-3 hover:text-ink-1'
                }`}
              >
                {m === 'url' ? 'URL' : 'Paste text'}
              </button>
            ))}
          </div>

          <div className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-3">
            {mode === 'url' ? (
              <div className="flex gap-2">
                <input
                  ref={urlRef}
                  autoFocus
                  type="url"
                  value={urlValue}
                  onChange={(e) => {
                    setUrlValue(e.target.value);
                    setError(null);
                    setPreview(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleFetchUrl();
                  }}
                  placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
                  className="flex-1 rounded-md border border-line bg-bg-subtle px-3 py-2 text-xs text-ink-1 outline-none focus:border-accent focus:shadow-focus placeholder:text-ink-4"
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  onClick={() => void handleFetchUrl()}
                  disabled={!urlValue.trim() || loading}
                >
                  {loading ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
            ) : (
              <div>
                <textarea
                  autoFocus
                  value={textValue}
                  onChange={(e) => {
                    setTextValue(e.target.value);
                    setError(null);
                    setPreview(null);
                  }}
                  placeholder="Paste JSON or YAML here…"
                  spellCheck={false}
                  rows={10}
                  className="w-full resize-none rounded-md border border-line bg-bg-subtle p-3 font-mono text-xs text-ink-1 outline-none focus:border-accent focus:shadow-focus placeholder:text-ink-4"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void handleParseText()}
                    disabled={!textValue.trim()}
                  >
                    Preview
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-md bg-method-delete/10 px-3 py-2 font-mono text-xs text-method-delete">
                {error}
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && !error && (
              <div className="rounded-md border border-method-put/30 bg-method-put/5 px-3 py-2 text-xs">
                <div className="font-semibold text-method-put mb-1">
                  {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
                </div>
                <ul className="space-y-0.5 list-disc list-inside text-ink-3">
                  {warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {warnings.length > 5 && (
                    <li className="text-ink-4">…and {warnings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Preview */}
            {preview && !error && (
              <div className="rounded-md border border-line bg-bg-subtle px-4 py-3 text-xs space-y-1.5">
                <div className="font-semibold text-ink-1 text-[11px] uppercase tracking-wide">
                  Preview
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-2">
                  <span>
                    <span className="font-medium text-ink-1">{preview.totalRequests}</span>{' '}
                    request{preview.totalRequests !== 1 ? 's' : ''}
                  </span>
                  <span>
                    <span className="font-medium text-ink-1">{preview.totalFolders}</span>{' '}
                    folder{preview.totalFolders !== 1 ? 's' : ''}
                  </span>
                  {preview.tags.length > 0 && (
                    <span>
                      Tags:{' '}
                      <span className="font-medium text-ink-1">
                        {preview.tags.slice(0, 5).join(', ')}
                        {preview.tags.length > 5 ? ` +${preview.tags.length - 5}` : ''}
                      </span>
                    </span>
                  )}
                  {preview.authTypes.length > 0 && (
                    <span>
                      Auth:{' '}
                      <span className="font-medium text-ink-1">
                        {preview.authTypes.join(', ')}
                      </span>
                    </span>
                  )}
                </div>
                <div className="text-ink-3">
                  Environment{' '}
                  <span className="font-medium text-ink-2">{preview.envName}</span>{' '}
                  will be created with{' '}
                  <span className="font-medium text-ink-2">{preview.envVarCount}</span>{' '}
                  variable{preview.envVarCount !== 1 ? 's' : ''} (auth secrets empty — fill them in after import).
                </div>
                {!workspace && (
                  <div className="text-method-delete font-medium">
                    Open a workspace before importing.
                  </div>
                )}
              </div>
            )}

            {/* Success */}
            {imported && (
              <div className="rounded-md bg-method-post/10 px-3 py-2 text-xs text-method-post">
                Import complete. The requests appear in the sidebar. Fill in the environment variable values (auth secrets) before sending.
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {imported ? 'Close' : 'Cancel'}
            </button>
            {!imported && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleImport()}
                disabled={!preview || !workspace || importing}
                title={
                  !workspace
                    ? 'Open a workspace first'
                    : !preview
                      ? 'Preview the spec first'
                      : undefined
                }
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
