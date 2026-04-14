import type { HttpVersion } from '@scrapeman/shared-types';
import type { SettingsState } from '../store.js';
import { useAppStore } from '../store.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';

export function SettingsTab(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateSettings = useAppStore((s) => s.updateSettings);

  if (!activeTab) return <div />;
  const s = activeTab.builder.settings;

  const patch = (next: Partial<SettingsState>): void => updateSettings(next);

  return (
    <div className="divide-y divide-line">
      <Section title="Proxy" description="Route this request through an HTTP/HTTPS/SOCKS5 proxy.">
        <Toggle
          label="Enable proxy"
          checked={s.proxy.enabled}
          onChange={(enabled) => patch({ proxy: { ...s.proxy, enabled } })}
        />
        <Row label="URL">
          <HighlightedInput
            value={s.proxy.url}
            onChange={(e) => patch({ proxy: { ...s.proxy, url: e.target.value } })}
            placeholder="http://proxy:8080  socks5://host:1080  https://{{proxyHost}}"
            variant="field"
            className="flex-1"
          />
        </Row>
        <Row label="Username">
          <HighlightedInput
            value={s.proxy.auth?.username ?? ''}
            onChange={(e) =>
              patch({
                proxy: {
                  ...s.proxy,
                  auth: {
                    username: e.target.value,
                    password: s.proxy.auth?.password ?? '',
                  },
                },
              })
            }
            placeholder="(optional)"
            variant="field"
            className="flex-1"
          />
        </Row>
        <Row label="Password">
          <HighlightedInput
            value={s.proxy.auth?.password ?? ''}
            onChange={(e) =>
              patch({
                proxy: {
                  ...s.proxy,
                  auth: {
                    username: s.proxy.auth?.username ?? '',
                    password: e.target.value,
                  },
                },
              })
            }
            placeholder="(optional)"
            variant="field"
            type="password"
            className="flex-1"
          />
        </Row>
      </Section>

      <Section title="Timeout" description="All values in milliseconds. Empty = engine default.">
        <NumberRow
          label="Connect"
          value={s.timeout.connect}
          onChange={(v) => patch({ timeout: { ...s.timeout, connect: v } })}
        />
        <NumberRow
          label="Read"
          value={s.timeout.read}
          onChange={(v) => patch({ timeout: { ...s.timeout, read: v } })}
        />
        <NumberRow
          label="Total"
          value={s.timeout.total}
          onChange={(v) => patch({ timeout: { ...s.timeout, total: v } })}
        />
      </Section>

      <Section title="Redirect">
        <Toggle
          label="Follow redirects"
          checked={s.redirect.follow}
          onChange={(follow) => patch({ redirect: { ...s.redirect, follow } })}
        />
        <Row label="Max count">
          <input
            type="number"
            value={s.redirect.maxCount}
            onChange={(e) =>
              patch({
                redirect: {
                  ...s.redirect,
                  maxCount: parseInt(e.target.value, 10) || 10,
                },
              })
            }
            disabled={!s.redirect.follow}
            className="field w-24 disabled:opacity-50"
          />
        </Row>
      </Section>

      <Section title="TLS">
        <Toggle
          label="Ignore invalid certificates"
          checked={s.tls.ignoreInvalidCerts}
          onChange={(ignoreInvalidCerts) => patch({ tls: { ignoreInvalidCerts } })}
        />
      </Section>

      <Section title="Protocol">
        <Row label="HTTP version">
          <select
            value={s.httpVersion}
            onChange={(e) => patch({ httpVersion: e.target.value as HttpVersion })}
            className="field w-40 cursor-pointer"
          >
            <option value="auto">Auto (ALPN)</option>
            <option value="http1">HTTP/1.1</option>
            <option value="http2">HTTP/2</option>
          </select>
        </Row>
      </Section>

      <Section
        title="scrape-do native mode"
        description="Route through api.scrape.do with structured parameters — no manual URL composition."
      >
        <Toggle
          label="Enable scrape-do"
          checked={s.scrapeDo.enabled}
          onChange={(enabled) => patch({ scrapeDo: { ...s.scrapeDo, enabled } })}
        />
        <Row label="Token">
          <HighlightedInput
            value={s.scrapeDo.token}
            onChange={(e) => patch({ scrapeDo: { ...s.scrapeDo, token: e.target.value } })}
            placeholder="{{scrapeDoToken}}"
            variant="field"
            className="flex-1"
          />
        </Row>
        <Toggle
          label="Render JavaScript"
          checked={s.scrapeDo.render ?? false}
          onChange={(render) => patch({ scrapeDo: { ...s.scrapeDo, render } })}
        />
        <Toggle
          label="Super proxy"
          checked={s.scrapeDo.super ?? false}
          onChange={(superEnabled) =>
            patch({ scrapeDo: { ...s.scrapeDo, super: superEnabled } })
          }
        />
        <Toggle
          label="Custom headers pass-through"
          checked={s.scrapeDo.customHeaders ?? false}
          onChange={(customHeaders) =>
            patch({ scrapeDo: { ...s.scrapeDo, customHeaders } })
          }
        />
        <Row label="Geo code">
          <input
            type="text"
            value={s.scrapeDo.geoCode ?? ''}
            onChange={(e) => patch({ scrapeDo: { ...s.scrapeDo, geoCode: e.target.value } })}
            placeholder="us"
            className="field w-24"
          />
        </Row>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="px-4 py-4">
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          {title}
        </div>
        {description && <div className="mt-0.5 text-xs text-ink-4">{description}</div>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-xs text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}): JSX.Element {
  return (
    <Row label={label}>
      <input
        type="number"
        value={value ?? ''}
        placeholder="default"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') onChange(null);
          else onChange(parseInt(raw, 10) || 0);
        }}
        className="field w-28"
      />
      <span className="text-[10px] text-ink-4">ms</span>
    </Row>
  );
}
