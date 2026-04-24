import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store.js';
import { MethodPicker } from './MethodPicker.js';
import { HeadersEditor } from './HeadersEditor.js';
import { AutoHeadersPanel } from './AutoHeadersPanel.js';
import { ParamsEditor, type ParamsEditorHandle } from './ParamsEditor.js';
import { SettingsTab as SettingsTabPanel } from './SettingsTab.js';
import { AuthTab } from './AuthTab.js';
import { CodePanel } from './CodePanel.js';
import { ImportCurlDialog } from './ImportCurlDialog.js';
import { ImportOpenApiDialog } from './ImportOpenApiDialog.js';
import { LoadTestPanel } from './LoadTestPanel.js';
import { WebSocketPanel } from './WebSocketPanel.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';
import { PromptDialog } from '../ui/Dialog.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';
import { formatJson } from '../utils/json-format.js';
import { ScreenshotModal } from './ScreenshotModal.js';
import { bridge } from '../bridge.js';

type Tab = 'params' | 'headers' | 'auth' | 'body' | 'settings' | 'code' | 'load' | 'websocket';

export function RequestBuilder(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const setMethod = useAppStore((s) => s.setMethod);
  const setUrl = useAppStore((s) => s.setUrl);
  const setBody = useAppStore((s) => s.setBody);
  const setBodyType = useAppStore((s) => s.setBodyType);
  const addHeader = useAppStore((s) => s.addHeader);
  const insertHeaderAfter = useAppStore((s) => s.insertHeaderAfter);
  const updateHeader = useAppStore((s) => s.updateHeader);
  const removeHeader = useAppStore((s) => s.removeHeader);
  const replaceHeaders = useAppStore((s) => s.replaceHeaders);
  const reorderHeader = useAppStore((s) => s.reorderHeader);
  const setDisabledAutoHeaders = useAppStore((s) => s.setDisabledAutoHeaders);
  const addParam = useAppStore((s) => s.addParam);
  const insertParamAfter = useAppStore((s) => s.insertParamAfter);
  const updateParam = useAppStore((s) => s.updateParam);
  const removeParam = useAppStore((s) => s.removeParam);
  const reorderParam = useAppStore((s) => s.reorderParam);
  const send = useAppStore((s) => s.send);
  const cancelSend = useAppStore((s) => s.cancelSend);
  const saveOrPrompt = useAppStore((s) => s.saveOrPrompt);
  const saveActiveAs = useAppStore((s) => s.saveActiveAs);
  const saveDialogOpen = useAppStore((s) => s.saveDialogOpen);
  const closeSaveDialog = useAppStore((s) => s.closeSaveDialog);
  const importCurl = useAppStore((s) => s.importCurlIntoActive);
  const newTab = useAppStore((s) => s.newTab);

  const tab = useAppStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)?.activePane ?? 'params',
  );
  const setTab = useAppStore((s) => s.setActivePane);
  const setScreenshotMode = useAppStore((s) => s.setScreenshotMode);
  const screenshotMode = useAppStore((s) => s.screenshotMode);
  const [importOpen, setImportOpen] = useState(false);
  const [importOpenApiOpen, setImportOpenApiOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  const takeScreenshot = useCallback(async (): Promise<void> => {
    setScreenshotMode(true);
    // Wait two frames so the Sidebar / TabBar have fully unmounted and
    // SplitPane re-layout has settled before we measure the capture rect.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    try {
      const target = document.getElementById('screenshot-target');
      const rect = target?.getBoundingClientRect();
      const dataUrl = await bridge.captureScreenshot(
        rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : undefined,
      );
      setScreenshotUrl(dataUrl);
    } finally {
      setScreenshotMode(false);
    }
  }, [setScreenshotMode]);

  // Ephemeral toast message shown in the body bar. Auto-clears after 3s.
  const [bodyToast, setBodyToast] = useState<string | null>(null);
  const bodyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBodyToast = useCallback((msg: string): void => {
    if (bodyToastTimerRef.current !== null) clearTimeout(bodyToastTimerRef.current);
    setBodyToast(msg);
    bodyToastTimerRef.current = setTimeout(() => setBodyToast(null), 3000);
  }, []);

  const handleBeautify = useCallback((): void => {
    const body = useAppStore.getState().tabs.find(
      (t) => t.id === useAppStore.getState().activeTabId,
    )?.builder.body ?? '';

    const result = formatJson(body);
    if (result.ok) {
      setBody(result.text);
    } else if (result.error === 'unresolved-variables') {
      showBodyToast('Cannot format: body contains unresolved {{variables}}');
    } else {
      showBodyToast(`Invalid JSON: ${result.error}`);
    }
  }, [setBody, showBodyToast]);

  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const focusUrlTick = useAppStore((s) => s.focusUrlTick);
  const focusUrlTickRef = useRef(focusUrlTick);
  useEffect(() => {
    // Skip on mount — only fire when the tick actually changes via ⌘L.
    if (focusUrlTick === focusUrlTickRef.current) return;
    focusUrlTickRef.current = focusUrlTick;
    urlInputRef.current?.focus();
    urlInputRef.current?.select();
  }, [focusUrlTick]);

  const paramsEditorRef = useRef<ParamsEditorHandle | null>(null);
  const focusParamsTick = useAppStore((s) => s.focusParamsTick);
  const focusParamsTickRef = useRef(focusParamsTick);
  useEffect(() => {
    if (focusParamsTick === focusParamsTickRef.current) return;
    focusParamsTickRef.current = focusParamsTick;
    setTab('params');
    // addAndFocus runs after the pane re-renders via requestAnimationFrame.
    requestAnimationFrame(() => paramsEditorRef.current?.addAndFocus());
  }, [focusParamsTick, setTab]);

  const importCurlTick = useAppStore((s) => s.importCurlTick);
  useEffect(() => {
    if (importCurlTick === 0) return;
    setImportOpen(true);
  }, [importCurlTick]);

  const importOpenApiTick = useAppStore((s) => s.importOpenApiTick);
  useEffect(() => {
    if (importOpenApiTick === 0) return;
    setImportOpenApiOpen(true);
  }, [importOpenApiTick]);

  const loadTestTick = useAppStore((s) => s.loadTestTick);
  useEffect(() => {
    if (loadTestTick === 0) return;
    setTab('load');
  }, [loadTestTick]);


  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-xs text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-bg-muted text-ink-3">
            ↗
          </div>
          <div className="text-sm font-semibold text-ink-1">No tab open</div>
          <div className="mt-1 text-xs text-ink-3">
            Open a request from the sidebar, or start a new tab.
          </div>
          <button onClick={newTab} className="btn-primary mt-4" title="Open new tab">
            New tab
          </button>
        </div>
      </div>
    );
  }

  const builder = activeTab.builder;
  const execution = activeTab.execution;
  const sending = execution.status === 'sending';
  const headerCount = builder.headers.filter((h) => h.enabled && h.key).length;
  const paramCount = builder.params.filter((p) => p.enabled && p.key).length;
  const bodyFilled = builder.bodyType !== 'none' && builder.body.trim().length > 0;
  const authActive = builder.auth.type !== 'none';
  const settingsActive =
    builder.settings.proxy.enabled ||
    builder.settings.scrapeDo.enabled ||
    builder.settings.tls.ignoreInvalidCerts ||
    !builder.settings.redirect.follow ||
    builder.settings.httpVersion !== 'auto' ||
    builder.settings.timeout.total !== null ||
    builder.settings.timeout.connect !== null ||
    builder.settings.timeout.read !== null;

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = e.clipboardData.getData('text');
    if (pasted.trim().startsWith('curl ')) {
      e.preventDefault();
      void importCurl(pasted);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-line px-4">
        <div className="flex flex-1 items-center gap-2 truncate">
          <div className="truncate text-sm font-semibold text-ink-1">
            {activeTab.name}
          </div>
          {activeTab.dirty && (
            <span
              title="Unsaved changes"
              className="h-1.5 w-1.5 rounded-full bg-accent"
            />
          )}
          {activeTab.kind === 'draft' && (
            <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              Draft
            </span>
          )}
        </div>
        {!screenshotMode && (
        <>
        <button
          onClick={() => setTab('load')}
          disabled={!builder.url.trim()}
          className="btn-ghost"
          title="Run load test"
        >
          Load test
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="btn-ghost"
          title="Import curl command"
        >
          Import curl
        </button>
        <button
          onClick={() => void takeScreenshot()}
          className="btn-ghost"
          title="Screenshot the current request + response view"
          aria-label="Take screenshot"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <button
          onClick={() => void saveOrPrompt()}
          disabled={activeTab.kind === 'file' && !activeTab.dirty}
          className="btn-ghost"
          title="Save request (⌘S)"
        >
          {activeTab.kind === 'file' ? 'Save' : 'Save as…'}
          <span className="ml-1.5 font-mono text-[10px] text-ink-4">
            {shortcutLabel('mod+s')}
          </span>
        </button>
        </>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <MethodPicker value={builder.method} onChange={setMethod} />
        <CellContextMenu value={builder.url} onChange={setUrl}>
          <div className="flex-1">
            <HighlightedInput
              ref={urlInputRef}
              value={builder.url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={handleUrlPaste}
              placeholder="https://api.example.com  or  paste a curl command"
              variant="field"
            />
          </div>
        </CellContextMenu>
        {!screenshotMode && (sending ? (
          <button
            onClick={cancelSend}
            className="btn-secondary min-w-[86px] gap-1.5"
            title="Cancel request"
          >
            <span className="spinner" aria-hidden="true" />
            Cancel
          </button>
        ) : (
          <button
            onClick={() => void send()}
            disabled={!builder.url.trim()}
            className="btn-primary min-w-[86px]"
            title="Send request (⌘↵)"
          >
            Send
          </button>
        ))}
      </div>

      {sending && <div className="progress-indeterminate" aria-hidden="true" />}

      <div className="flex h-9 items-center border-b border-line px-4">
        <TabButton active={tab === 'params'} onClick={() => setTab('params')}>
          Params
          {paramCount > 0 && (
            <span className="ml-1.5 rounded-full bg-bg-muted px-1.5 text-[10px] font-semibold text-ink-3">
              {paramCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === 'headers'} onClick={() => setTab('headers')}>
          Headers
          {headerCount > 0 && (
            <span className="ml-1.5 rounded-full bg-bg-muted px-1.5 text-[10px] font-semibold text-ink-3">
              {headerCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === 'auth'} onClick={() => setTab('auth')}>
          Auth
          {authActive && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </TabButton>
        <TabButton active={tab === 'body'} onClick={() => setTab('body')}>
          Body
          {bodyFilled && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          Settings
          {settingsActive && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </TabButton>
        <TabButton active={tab === 'code'} onClick={() => setTab('code')}>
          Code
        </TabButton>
        <TabButton active={tab === 'load'} onClick={() => setTab('load')}>
          Load Test
        </TabButton>
        <TabButton active={tab === 'websocket'} onClick={() => setTab('websocket')}>
          WebSocket
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'params' && (
          <ParamsEditor
            ref={paramsEditorRef}
            rows={builder.params}
            onAdd={addParam}
            onInsertAfter={insertParamAfter}
            onUpdate={updateParam}
            onRemove={removeParam}
            onReorder={reorderParam}
          />
        )}
        {tab === 'headers' && (
          <div className="flex flex-col">
            <AutoHeadersPanel
              builder={builder}
              onChange={setDisabledAutoHeaders}
            />
            <HeadersEditor
              rows={builder.headers}
              onAdd={addHeader}
              onInsertAfter={insertHeaderAfter}
              onUpdate={updateHeader}
              onRemove={removeHeader}
              onReplace={replaceHeaders}
              onReorder={reorderHeader}
            />
          </div>
        )}
        {tab === 'auth' && <AuthTab />}
        {tab === 'settings' && <SettingsTabPanel />}
        {tab === 'code' && <CodePanel />}
        {tab === 'body' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-1 border-b border-line px-4 py-2">
              <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                Type
              </span>
              {(['none', 'json', 'text'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setBodyType(type)}
                  title={`Set body type to ${type}`}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    builder.bodyType === type
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
                  }`}
                >
                  {type}
                </button>
              ))}
              {/* Beautify button — only visible when body mode is JSON */}
              {builder.bodyType === 'json' && (
                <button
                  onClick={handleBeautify}
                  title="Beautify JSON (⇧⌘F while editor is focused)"
                  className="ml-auto rounded px-2 py-0.5 text-xs font-medium text-ink-3 hover:bg-bg-hover hover:text-ink-1"
                >
                  Beautify
                </button>
              )}
            </div>
            {/* Inline toast — shown below the type bar, above the editor */}
            {bodyToast !== null && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 border-b border-line bg-bg-muted px-4 py-1.5 text-xs text-ink-2"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  Notice
                </span>
                {bodyToast}
              </div>
            )}
            <textarea
              value={builder.body}
              onChange={(e) => setBody(e.target.value)}
              disabled={builder.bodyType === 'none'}
              placeholder={
                builder.bodyType === 'none'
                  ? 'Select a body type above to edit.'
                  : builder.bodyType === 'json'
                    ? '{\n  "key": "value"\n}'
                    : ''
              }
              spellCheck={false}
              onKeyDown={(e) => {
                // Shift+Cmd/Ctrl+F beautifies when the body editor is focused.
                // stopPropagation prevents the global "focus sidebar search" handler
                // (also bound to mod+shift+f) from firing simultaneously.
                const isMod = e.metaKey || e.ctrlKey;
                if (isMod && e.shiftKey && e.key.toLowerCase() === 'f') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (builder.bodyType === 'json') {
                    handleBeautify();
                  }
                }
              }}
              className="flex-1 resize-none border-0 bg-bg-canvas p-4 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4 disabled:bg-bg-subtle disabled:text-ink-4"
            />
          </div>
        )}
        {/* Load test panel uses display:none to preserve run state across tab switches */}
        <div className={tab === 'load' ? 'flex h-full flex-col' : 'hidden'}>
          <LoadTestPanel />
        </div>
        {/* WebSocket panel: only mounted when the pane is selected. Connection state lives in the
            store so switching tabs does not tear down the open socket. */}
        {tab === 'websocket' && (
          <WebSocketPanel tabId={activeTab.id} />
        )}
      </div>

      <ImportCurlDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importCurl}
      />

      <ImportOpenApiDialog
        open={importOpenApiOpen}
        onClose={() => setImportOpenApiOpen(false)}
      />

      <PromptDialog
        open={saveDialogOpen}
        title="Save request"
        description="Pick a name. Use slashes to create folders — e.g. api/users/list saves under api/users/."
        placeholder="api/users/list"
        initialValue={activeTab.name === 'Untitled' ? '' : activeTab.name}
        confirmLabel="Save"
        onConfirm={(name) => void saveActiveAs('', name)}
        onClose={closeSaveDialog}
      />

      <ScreenshotModal
        dataUrl={screenshotUrl}
        onClose={() => setScreenshotUrl(null)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button onClick={onClick} className={`tab ${active ? 'tab-active' : ''}`}>
      {children}
    </button>
  );
}
