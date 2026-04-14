import { useState, type ReactNode } from 'react';

export function JsonTree({ value }: { value: unknown }): JSX.Element {
  return (
    <div className="font-mono text-xs leading-[18px] text-ink-1">
      <Node value={value} path="$" depth={0} initialOpen={true} />
    </div>
  );
}

function Node({
  value,
  path,
  depth,
  keyLabel,
  initialOpen = false,
}: {
  value: unknown;
  path: string;
  depth: number;
  keyLabel?: string | undefined;
  initialOpen?: boolean;
}): JSX.Element {
  if (value === null) {
    return <Leaf keyLabel={keyLabel} path={path} display={<Null />} />;
  }
  if (typeof value === 'boolean') {
    return (
      <Leaf
        keyLabel={keyLabel}
        path={path}
        display={<span className="text-method-patch">{String(value)}</span>}
      />
    );
  }
  if (typeof value === 'number') {
    return (
      <Leaf
        keyLabel={keyLabel}
        path={path}
        display={<span className="text-method-put">{value}</span>}
      />
    );
  }
  if (typeof value === 'string') {
    return (
      <Leaf
        keyLabel={keyLabel}
        path={path}
        display={<span className="text-method-get">"{value}"</span>}
      />
    );
  }

  if (Array.isArray(value)) {
    return (
      <CollapsibleNode
        keyLabel={keyLabel}
        path={path}
        depth={depth}
        initialOpen={initialOpen}
        openBracket="["
        closeBracket="]"
        count={value.length}
        countLabel={value.length === 1 ? 'item' : 'items'}
      >
        {value.map((item, i) => (
          <Node
            key={i}
            value={item}
            path={`${path}[${i}]`}
            depth={depth + 1}
            keyLabel={String(i)}
            initialOpen={initialOpen}
          />
        ))}
      </CollapsibleNode>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <CollapsibleNode
        keyLabel={keyLabel}
        path={path}
        depth={depth}
        initialOpen={initialOpen}
        openBracket="{"
        closeBracket="}"
        count={entries.length}
        countLabel={entries.length === 1 ? 'key' : 'keys'}
      >
        {entries.map(([k, v]) => (
          <Node
            key={k}
            value={v}
            path={`${path}.${jsonPathSegment(k)}`}
            depth={depth + 1}
            keyLabel={k}
            initialOpen={initialOpen}
          />
        ))}
      </CollapsibleNode>
    );
  }

  return <Leaf keyLabel={keyLabel} path={path} display={<Null />} />;
}

function CollapsibleNode({
  keyLabel,
  path,
  depth,
  initialOpen,
  openBracket,
  closeBracket,
  count,
  countLabel,
  children,
}: {
  keyLabel?: string | undefined;
  path: string;
  depth: number;
  initialOpen: boolean;
  openBracket: string;
  closeBracket: string;
  count: number;
  countLabel: string;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(initialOpen);

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      <div
        className="group flex cursor-default items-center gap-1 rounded hover:bg-bg-hover"
        onClick={() => setOpen(!open)}
        onContextMenu={(e) => {
          e.preventDefault();
          void navigator.clipboard.writeText(path);
        }}
        title={`${path}  (right-click to copy path)`}
      >
        <span className="w-3 select-none text-center text-[9px] text-ink-4">
          {open ? '▾' : '▸'}
        </span>
        {keyLabel !== undefined && (
          <>
            <span className="text-ink-3">"{keyLabel}"</span>
            <span className="text-ink-4">:</span>
          </>
        )}
        <span className="text-ink-2">{openBracket}</span>
        {!open && (
          <span className="text-[10px] text-ink-4">
            {' '}
            {count} {countLabel}{' '}
          </span>
        )}
        {!open && <span className="text-ink-2">{closeBracket}</span>}
      </div>
      {open && <div>{children}</div>}
      {open && (
        <div
          style={{ paddingLeft: 14 }}
          className="text-ink-2"
        >
          {closeBracket}
        </div>
      )}
    </div>
  );
}

function Leaf({
  keyLabel,
  path,
  display,
}: {
  keyLabel?: string | undefined;
  path: string;
  display: ReactNode;
}): JSX.Element {
  return (
    <div
      className="group flex cursor-default items-center gap-1 rounded pl-4 hover:bg-bg-hover"
      onContextMenu={(e) => {
        e.preventDefault();
        void navigator.clipboard.writeText(path);
      }}
      title={`${path}  (right-click to copy path)`}
    >
      {keyLabel !== undefined && (
        <>
          <span className="text-ink-3">"{keyLabel}"</span>
          <span className="text-ink-4">:</span>
        </>
      )}
      {display}
    </div>
  );
}

function Null(): JSX.Element {
  return <span className="text-ink-4">null</span>;
}

function jsonPathSegment(key: string): string {
  // Plain identifier or quoted bracket form for keys with special characters.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return key;
  return `["${key.replace(/"/g, '\\"')}"]`;
}
