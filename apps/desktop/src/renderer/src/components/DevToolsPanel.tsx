import type {
  ExecutedResponse,
  RedirectHop,
  ScriptConsoleEntry,
  TlsCertInfo,
} from '@scrapeman/shared-types';

// ─── Timing waterfall ────────────────────────────────────────────────────────

interface TimingSegment {
  label: string;
  ms: number;
  colorClass: string;
}

// Color assignments follow the existing Tailwind palette used elsewhere in
// the response viewer. Each segment has a distinct fill that stays readable
// in both light and dark mode.
const SEGMENT_COLORS: Record<string, string> = {
  DNS: 'bg-method-delete',
  TCP: 'bg-method-post',
  TLS: 'bg-method-put',
  TTFB: 'bg-accent',
  Download: 'bg-status-ok',
};

function TimingWaterfall({ timings }: { timings: ExecutedResponse['timings'] }): JSX.Element {
  const allSegments = [
    { label: 'DNS', ms: timings.dnsMs, colorClass: SEGMENT_COLORS.DNS! },
    { label: 'TCP', ms: timings.connectMs, colorClass: SEGMENT_COLORS.TCP! },
    { label: 'TLS', ms: timings.tlsMs, colorClass: SEGMENT_COLORS.TLS! },
    { label: 'TTFB', ms: timings.ttfbMs, colorClass: SEGMENT_COLORS.TTFB! },
    { label: 'Download', ms: timings.downloadMs, colorClass: SEGMENT_COLORS.Download! },
  ];
  const segments: TimingSegment[] = allSegments.flatMap((s) =>
    s.ms !== undefined ? [{ label: s.label, ms: s.ms, colorClass: s.colorClass }] : [],
  );

  const totalMs = timings.totalMs;
  // Guard against zero-duration requests so we don't divide by zero.
  const safeTotal = Math.max(totalMs, 0.001);

  if (segments.length === 0) {
    return (
      <p className="text-xs text-ink-4">
        Only the total time is available — individual phase breakdowns were not measured.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {segments.map((seg) => {
        const pct = Math.max(1, (seg.ms / safeTotal) * 100);
        return (
          <div key={seg.label} className="flex items-center gap-3">
            <span className="w-16 text-right text-[11px] font-medium text-ink-3">
              {seg.label}
            </span>
            <div className="flex flex-1 items-center gap-2">
              <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-bg-subtle">
                <div
                  className={`absolute inset-y-0 left-0 rounded-sm ${seg.colorClass}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-20 font-mono text-[11px] text-ink-2">
                {formatMs(seg.ms)}
              </span>
            </div>
          </div>
        );
      })}

      {/* Total row */}
      <div className="flex items-center gap-3 border-t border-line pt-2">
        <span className="w-16 text-right text-[11px] font-medium text-ink-4">Total</span>
        <div className="flex flex-1 items-center gap-2">
          <div className="flex-1" />
          <span className="w-20 font-mono text-[11px] font-semibold text-ink-1">
            {formatMs(totalMs)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Redirect chain ───────────────────────────────────────────────────────────

function RedirectChainView({ chain }: { chain: RedirectHop[] }): JSX.Element {
  return (
    <div className="space-y-1">
      {chain.map((hop, i) => (
        <div key={i} className="flex items-start gap-2 font-mono text-xs">
          <span
            className={`mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(hop.status)}`}
          >
            {hop.status}
          </span>
          <div className="flex flex-col">
            <span className="break-all text-ink-2">{hop.url}</span>
            <span className="flex items-center gap-1 text-ink-4">
              <span>→</span>
              <span className="break-all text-ink-3">{hop.location}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── TLS certificate card ─────────────────────────────────────────────────────

function TlsCertCard({ cert }: { cert: TlsCertInfo }): JSX.Element {
  const now = Date.now();
  const validTo = new Date(cert.validTo).getTime();
  const expired = validTo < now;
  const daysLeft = Math.round((validTo - now) / (1000 * 60 * 60 * 24));

  return (
    <div className="rounded border border-line bg-bg-subtle p-3 text-xs">
      <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5">
        <span className="text-ink-4">Subject</span>
        <span className="font-mono text-ink-1 break-all">{cert.subjectCN || '—'}</span>
        <span className="text-ink-4">Issuer</span>
        <span className="font-mono text-ink-1 break-all">{cert.issuerCN || '—'}</span>
        <span className="text-ink-4">Valid from</span>
        <span className="font-mono text-ink-2">{cert.validFrom}</span>
        <span className="text-ink-4">Valid to</span>
        <span className={`font-mono ${expired ? 'text-method-delete' : 'text-ink-2'}`}>
          {cert.validTo}
          {!expired && daysLeft >= 0 && daysLeft <= 30 && (
            <span className="ml-2 text-method-post">({daysLeft}d left)</span>
          )}
          {expired && <span className="ml-2 text-method-delete">(expired)</span>}
        </span>
        <span className="text-ink-4">Fingerprint</span>
        <span className="break-all font-mono text-[10px] text-ink-3">{cert.fingerprint256}</span>
      </div>
    </div>
  );
}

// ─── Sent-headers table ───────────────────────────────────────────────────────

function SentHeadersTable({ headers }: { headers: Array<[string, string]> }): JSX.Element {
  return (
    <div className="overflow-auto rounded border border-line">
      <div className="grid grid-cols-[240px_1fr] border-b border-line bg-bg-subtle px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        <div className="py-2">Name</div>
        <div className="py-2">Value</div>
      </div>
      {headers.map(([name, value], i) => (
        <div
          key={i}
          className="grid grid-cols-[240px_1fr] border-b border-line-subtle px-3 hover:bg-bg-subtle"
        >
          <div className="truncate py-1.5 font-mono text-xs text-ink-3">{name}</div>
          <div className="break-all py-1.5 font-mono text-xs text-ink-1">{value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Script console ───────────────────────────────────────────────────────────

const CONSOLE_LEVEL_STYLE: Record<ScriptConsoleEntry['level'], string> = {
  log: 'text-ink-2',
  info: 'text-accent',
  warn: 'text-method-post',
  error: 'text-method-delete',
};

function ScriptConsole({
  entries,
}: {
  entries: ScriptConsoleEntry[] | undefined;
}): JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <p className="rounded border border-line bg-bg-subtle px-4 py-3 text-xs text-ink-4">
        No script output
      </p>
    );
  }
  return (
    <div className="overflow-auto rounded border border-line bg-bg-subtle p-2">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-baseline gap-2 py-0.5">
          <span className="w-10 text-right font-mono text-[10px] text-ink-4">
            {entry.level}
          </span>
          <span className={`flex-1 break-all font-mono text-xs ${CONSOLE_LEVEL_STYLE[entry.level]}`}>
            {entry.message}
          </span>
          <span className="font-mono text-[10px] text-ink-4">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── DevToolsPanel ────────────────────────────────────────────────────────────

export function DevToolsPanel({ response }: { response: ExecutedResponse }): JSX.Element {
  const hasCompression =
    response.compressedSize !== undefined &&
    response.sizeBytes !== response.compressedSize;

  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      {/* Timing waterfall */}
      <Section title="Timing">
        <TimingWaterfall timings={response.timings} />
      </Section>

      {/* Sent request metadata */}
      <Section title="Request">
        <MetadataGrid>
          {response.sentUrl !== undefined && (
            <MetaRow label="URL">
              <span className="break-all font-mono text-xs text-ink-1">{response.sentUrl}</span>
            </MetaRow>
          )}
          <MetaRow label="HTTP version">
            <span className="font-mono text-xs text-ink-1">{response.httpVersion}</span>
          </MetaRow>
          {response.remoteAddress !== undefined && (
            <MetaRow label="Remote address">
              <span className="font-mono text-xs text-ink-1">
                {response.remoteAddress}
                {response.remotePort !== undefined ? `:${response.remotePort}` : ''}
              </span>
            </MetaRow>
          )}
          {hasCompression && response.compressedSize !== undefined && (
            <MetaRow label="Compression">
              <span className="font-mono text-xs text-ink-1">
                {formatBytes(response.compressedSize)}
                {' → '}
                {formatBytes(response.sizeBytes)}
                {' ('}
                {(response.sizeBytes / response.compressedSize).toFixed(1)}
                {'× decoded)'}
              </span>
            </MetaRow>
          )}
          {!hasCompression && (
            <MetaRow label="Size">
              <span className="font-mono text-xs text-ink-1">
                {formatBytes(response.sizeBytes)}
              </span>
            </MetaRow>
          )}
        </MetadataGrid>
      </Section>

      {/* Sent headers */}
      {response.sentHeaders !== undefined && response.sentHeaders.length > 0 && (
        <Section title="Sent headers">
          <SentHeadersTable headers={response.sentHeaders} />
        </Section>
      )}

      {/* Redirect chain */}
      {response.redirectChain !== undefined && response.redirectChain.length > 0 && (
        <Section title={`Redirect chain (${response.redirectChain.length} hop${response.redirectChain.length > 1 ? 's' : ''})`}>
          <RedirectChainView chain={response.redirectChain} />
        </Section>
      )}

      {/* TLS certificate */}
      {response.tlsCert !== undefined ? (
        <Section title="TLS certificate">
          <TlsCertCard cert={response.tlsCert} />
        </Section>
      ) : (
        response.sentUrl !== undefined && response.sentUrl.startsWith('https') && (
          <Section title="TLS certificate">
            <p className="text-xs text-ink-4">TLS info unavailable.</p>
          </Section>
        )
      )}

      {/* Script console */}
      <Section title="Script console">
        <ScriptConsole entries={response.scriptConsole} />
      </Section>
    </div>
  );
}

// ─── Layout primitives ────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        {title}
      </h3>
      {children}
    </section>
  );
}

function MetadataGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="space-y-1">{children}</div>;
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-32 shrink-0 text-right text-[11px] font-medium text-ink-4">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusColor(status: number): string {
  if (status >= 300 && status < 400) return 'bg-status-redirect/10 text-status-redirect';
  if (status >= 200 && status < 300) return 'bg-status-ok/10 text-status-ok';
  return 'bg-bg-muted text-ink-3';
}
