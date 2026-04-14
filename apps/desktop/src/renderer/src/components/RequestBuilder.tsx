import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store.js';
import { MethodPicker } from './MethodPicker.js';
import { HeadersEditor } from './HeadersEditor.js';
import { ParamsEditor } from './ParamsEditor.js';
import { SettingsTab as SettingsTabPanel } from './SettingsTab.js';
import { AuthTab } from './AuthTab.js';
import { CodePanel } from './CodePanel.js';
import { ImportCurlDialog } from './ImportCurlDialog.js';
import { LoadTestDialog } from './LoadTestDialog.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';
import { PromptDialog } from '../ui/Dialog.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';

type Tab = 'params' | 'headers' | 'auth' | 'body' | 'settings' | 'code';

export function RequestBuilder(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const setMethod = useAppStore((s) => s.setMethod);
  const setUrl = useAppStore((s) => s.setUrl);
  const setBody = useAppStore((s) => s.setBody);
  const setBodyType = useAppStore((s) => s.setBodyType);
  const addHeader = useAppStore((s) => s.addHeader);
  const updateHeader = useAppStore((s) => s.updateHeader);
  const removeHeader = useAppStore((s) => s.removeHeader);
  const addParam = useAppStore((s) => s.addParam);
  const updateParam = useAppStore((s) => s.updateParam);
  const removeParam = useAppStore((s) => s.removeParam);
  const send = useAppStore((s) => s.send);
  const cancelSend = useAppStore((s) => s.cancelSend);
  const saveOrPrompt = useAppStore((s) => s.saveOrPrompt);
  const saveActiveAs = useAppStore((s) => s.saveActiveAs);
  const saveDialogOpen = useAppStore((s) => s.saveDialogOpen);
  const closeSaveDialog = useAppStore((s) => s.closeSaveDialog);
  const importCurl = useAppStore((s) => s.importCurlIntoActive);
  const newTab = useAppStore((s) => s.newTab);

  const [tab, setTab] = useState<Tab>('params');
  const [importOpen, setImportOpen] = useState(false);
  const [loadTestOpen, setLoadTestOpen] = useState(false);

  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const focusUrlTick = useAppStore((s) => s.focusUrlTick);
  useEffect(() => {
    if (focusUrlTick === 0) return;
    urlInputRef.current?.focus();
    urlInputRef.current?.select();
  }, [focusUrlTick]);

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
          <button onClick={newTab} className="btn-primary mt-4">
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
        <button
          onClick={() => setLoadTestOpen(true)}
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
          onClick={() => void saveOrPrompt()}
          disabled={activeTab.kind === 'file' && !activeTab.dirty}
          className="btn-ghost"
        >
          {activeTab.kind === 'file' ? 'Save' : 'Save as…'}
          <span className="ml-1.5 font-mono text-[10px] text-ink-4">
            {shortcutLabel('mod+s')}
          </span>
        </button>
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
        {sending ? (
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
          >
            Send
          </button>
        )}
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
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'params' && (
          <ParamsEditor
            rows={builder.params}
            onAdd={addParam}
            onUpdate={updateParam}
            onRemove={removeParam}
          />
        )}
        {tab === 'headers' && (
          <HeadersEditor
            rows={builder.headers}
            onAdd={addHeader}
            onUpdate={updateHeader}
            onRemove={removeHeader}
          />
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
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    builder.bodyType === type
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
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
              className="flex-1 resize-none border-0 bg-bg-canvas p-4 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-4 disabled:bg-bg-subtle disabled:text-ink-4"
            />
          </div>
        )}
      </div>

      <ImportCurlDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importCurl}
      />

      <LoadTestDialog
        open={loadTestOpen}
        onClose={() => setLoadTestOpen(false)}
      />

      <PromptDialog
        open={saveDialogOpen}
        title="Save request"
        description="Pick a name. The request will be saved to the workspace root — you can move it from the sidebar afterwards."
        placeholder="Get user profile"
        initialValue={activeTab.name === 'Untitled' ? '' : activeTab.name}
        confirmLabel="Save"
        onConfirm={(name) => void saveActiveAs('', name)}
        onClose={closeSaveDialog}
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
