import { useEffect, useRef, useState } from 'react';
import type { JwtDecoded } from '@scrapeman/shared-types';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';

interface Props {
  label: string;
  token: string;
}

/**
 * Decode and display a JWT (header + payload). No signature verification —
 * display only. Shows a live countdown to `exp` when present.
 */
export function JwtInspector({ label, token }: Props): JSX.Element | null {
  const [decoded, setDecoded] = useState<JwtDecoded | null | 'loading'>('loading');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      setDecoded(null);
      return;
    }
    void window.scrapeman.oauth2DecodeJwt(token).then((result) => {
      setDecoded(result);
    });
  }, [token]);

  if (decoded === 'loading' || decoded === null) return null;

  return (
    <div className="rounded-md border border-line bg-bg-canvas text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-ink-3 hover:text-ink-1"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{label}</span>
        <ExpBadge payload={decoded.payload} />
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2 font-mono">
          <Section title="Header" data={decoded.header} />
          <Section title="Payload" data={decoded.payload} />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown>;
}): JSX.Element {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
        {title}
      </div>
      <div className="overflow-x-auto rounded bg-bg-base p-2 text-ink-2">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="shrink-0 text-accent">{k}</span>
            <span className="text-ink-1">{formatValue(k, v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatValue(key: string, value: unknown): string {
  // Render Unix timestamps as human-readable dates for common JWT claims.
  if ((key === 'exp' || key === 'iat' || key === 'nbf') && typeof value === 'number') {
    return `${String(value)} (${new Date(value * 1000).toLocaleString()})`;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Shows a live countdown (or "expired") based on the `exp` claim.
 */
function ExpBadge({ payload }: { payload: Record<string, unknown> }): JSX.Element | null {
  const exp = typeof payload['exp'] === 'number' ? payload['exp'] : null;
  const [label, setLabel] = useState<string>('');
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (exp === null) return;

    const tick = (): void => {
      const remaining = exp * 1000 - Date.now();
      if (remaining <= 0) {
        setLabel('expired');
      } else {
        const s = Math.floor(remaining / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) {
          setLabel(`${h}h ${m % 60}m`);
        } else if (m > 0) {
          setLabel(`${m}m ${s % 60}s`);
        } else {
          setLabel(`${s}s`);
        }
        rafRef.current = window.setTimeout(tick, 1000);
      }
    };

    tick();
    return () => {
      if (rafRef.current !== null) clearTimeout(rafRef.current);
    };
  }, [exp]);

  if (!label) return null;

  const isExpired = label === 'expired';
  return (
    <span
      className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isExpired ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
      }`}
    >
      <Clock size={10} />
      {label}
    </span>
  );
}
