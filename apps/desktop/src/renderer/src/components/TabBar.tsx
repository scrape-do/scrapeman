import { useAppStore, type Tab } from '../store.js';
import { shortcutLabel } from '../hooks/useShortcuts.js';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

export function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const newTab = useAppStore((s) => s.newTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="flex h-10 items-center border-b border-line bg-bg-subtle">
      <div className="flex h-full flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </div>
      <button
        onClick={newTab}
        title={`New tab (${shortcutLabel('mod+t')})`}
        className="flex h-full w-10 items-center justify-center border-l border-line text-ink-3 transition-colors hover:bg-bg-hover hover:text-ink-1"
      >
        +
      </button>
    </div>
  );
}

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}): JSX.Element {
  const color = METHOD_COLOR[tab.method] ?? 'text-method-custom';

  return (
    <div
      onClick={onSelect}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`group relative flex h-full min-w-[160px] max-w-[240px] cursor-default items-center gap-2 border-r border-line px-3 text-xs transition-colors ${
        active
          ? 'bg-bg-canvas text-ink-1'
          : 'text-ink-3 hover:bg-bg-hover hover:text-ink-1'
      }`}
    >
      {active && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
      )}
      <span className={`font-mono text-[10px] font-semibold ${color}`}>
        {tab.method.slice(0, 6)}
      </span>
      <span className="flex-1 truncate">{tab.name}</span>
      {tab.dirty ? (
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-ink-4 opacity-0 transition-opacity hover:bg-bg-active hover:text-ink-1 group-hover:opacity-100"
          aria-label="Close tab"
        >
          ×
        </button>
      )}
    </div>
  );
}
