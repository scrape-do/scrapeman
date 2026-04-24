import { useState } from 'react';
import type { HttpVersion } from '@scrapeman/shared-types';
import type { SettingsState } from '../store.js';
import { useAppStore } from '../store.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';

// UA preset display names — kept in the renderer so we avoid importing
// http-core (which drags undici into the browser bundle).
const UA_PRESET_OPTIONS: Array<{ key: string; label: string; ua: string }> = [
  { key: 'scrapeman', label: 'Scrapeman (default)', ua: 'Scrapeman/<version> (<platform>)' },
  {
    key: 'chrome-macos',
    label: 'Chrome 124 macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    key: 'chrome-windows',
    label: 'Chrome 124 Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    key: 'firefox-macos',
    label: 'Firefox 125 macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  },
  {
    key: 'firefox-windows',
    label: 'Firefox 125 Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  },
  {
    key: 'safari-macos',
    label: 'Safari 17 macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  },
  {
    key: 'safari-ios',
    label: 'Safari 17 iOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    key: 'googlebot',
    label: 'Googlebot 2.1',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  { key: 'curl', label: 'curl 8.7', ua: 'curl/8.7.1' },
];

export function SettingsTab(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [rotateInput, setRotateInput] = useState('');

  if (!activeTab) return <div />;
  const s = activeTab.builder.settings;

  const patch = (next: Partial<SettingsState>): void => updateSettings(next);

  const rotateUrls = s.proxy.rotate?.urls ?? [];
  const rotateStrategy = s.proxy.rotate?.strategy ?? 'round-robin';
  const rotateEnabled = rotateUrls.length > 0;

  const selectedPreset = UA_PRESET_OPTIONS.find((o) => o.key === s.uaPreset) ?? UA_PRESET_OPTIONS[0]!;

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
            className={`flex-1 ${rotateEnabled ? 'opacity-40' : ''}`}
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

        <div className="mt-1 border-t border-line-subtle pt-2">
          <Toggle
            label="Rotate through multiple proxies"
            checked={rotateEnabled}
            onChange={(on) => {
              if (on) {
                patch({
                  proxy: {
                    ...s.proxy,
                    rotate: { urls: [], strategy: rotateStrategy },
                  },
                });
              } else {
                const { rotate: _omit, ...rest } = s.proxy as typeof s.proxy & { rotate?: unknown };
                patch({ proxy: rest as typeof s.proxy });
              }
            }}
          />
          {rotateEnabled && (
            <div className="mt-2 flex flex-col gap-2">
              <Row label="Strategy">
                <select
                  value={rotateStrategy}
                  onChange={(e) =>
                    patch({
                      proxy: {
                        ...s.proxy,
                        rotate: { urls: rotateUrls, strategy: e.target.value as 'round-robin' | 'random' },
                      },
                    })
                  }
                  className="field w-36 cursor-pointer"
                >
                  <option value="round-robin">Round-robin</option>
                  <option value="random">Random</option>
                </select>
              </Row>
              <div className="flex flex-col gap-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                  Proxy list ({rotateUrls.length})
                </div>
                {rotateUrls.map((url, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-ink-4">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => {
                        const next = [...rotateUrls];
                        next[i] = e.target.value;
                        patch({ proxy: { ...s.proxy, rotate: { urls: next, strategy: rotateStrategy } } });
                      }}
                      className="field flex-1 font-mono text-xs"
                    />
                    <button
                      onClick={() => {
                        const next = rotateUrls.filter((_, j) => j !== i);
                        patch({ proxy: { ...s.proxy, rotate: { urls: next, strategy: rotateStrategy } } });
                      }}
                      className="text-ink-4 hover:text-method-delete"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={rotateInput}
                    onChange={(e) => setRotateInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && rotateInput.trim()) {
                        patch({
                          proxy: {
                            ...s.proxy,
                            rotate: { urls: [...rotateUrls, rotateInput.trim()], strategy: rotateStrategy },
                          },
                        });
                        setRotateInput('');
                      }
                    }}
                    placeholder="http://proxy:port  (Enter to add)"
                    className="field flex-1 font-mono text-xs"
                  />
                  <button
                    onClick={() => {
                      if (!rotateInput.trim()) return;
                      patch({
                        proxy: {
                          ...s.proxy,
                          rotate: { urls: [...rotateUrls, rotateInput.trim()], strategy: rotateStrategy },
                        },
                      });
                      setRotateInput('');
                    }}
                    className="rounded px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-bg-hover"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="User-Agent"
        description="Preset UA string sent as the User-Agent header. Overridden if you set User-Agent manually in the Headers tab."
      >
        <Row label="Preset">
          <select
            value={s.uaPreset}
            onChange={(e) => patch({ uaPreset: e.target.value })}
            className="field w-48 cursor-pointer"
          >
            {UA_PRESET_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <div className="mt-1 truncate font-mono text-[10px] text-ink-4" title={selectedPreset.ua}>
          {selectedPreset.ua}
        </div>
      </Section>

      <Section
        title="Rate limit"
        description="Delay between requests in the Collection Runner and Load Runner. No-op on single send."
      >
        <Toggle
          label="Enable rate limit"
          checked={s.rateLimit.enabled}
          onChange={(enabled) => patch({ rateLimit: { ...s.rateLimit, enabled } })}
        />
        <NumberRow
          label="Fixed delay"
          value={s.rateLimit.fixedDelayMs || null}
          onChange={(v) => patch({ rateLimit: { ...s.rateLimit, fixedDelayMs: v ?? 0 } })}
        />
        <NumberRow
          label="Jitter min"
          value={s.rateLimit.jitterMinMs ?? null}
          onChange={(v) => {
            const next = { ...s.rateLimit };
            if (v !== null) { next.jitterMinMs = v; } else { delete (next as Partial<typeof next>).jitterMinMs; }
            patch({ rateLimit: next });
          }}
        />
        <NumberRow
          label="Jitter max"
          value={s.rateLimit.jitterMaxMs ?? null}
          onChange={(v) => {
            const next = { ...s.rateLimit };
            if (v !== null) { next.jitterMaxMs = v; } else { delete (next as Partial<typeof next>).jitterMaxMs; }
            patch({ rateLimit: next });
          }}
        />
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

      <Section
        title="Validation"
        description="If set, the response body is checked for this substring and the result (match / mismatch) appears in the response status bar."
      >
        <Row label="Expected text">
          <HighlightedInput
            value={s.validateBody}
            onChange={(e) => patch({ validateBody: e.target.value })}
            placeholder="e.g. &quot;success&quot; or {{expectedName}}"
            variant="field"
            className="flex-1"
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
