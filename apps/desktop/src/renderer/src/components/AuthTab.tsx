import { useEffect, useState } from 'react';
import type { AuthConfig, InheritedAuthInfo, OAuth2TokenResult } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';
import { JwtInspector } from './JwtInspector.js';

type AuthKind = AuthConfig['type'];

const AUTH_TYPES: Array<{ kind: AuthKind; label: string }> = [
  { kind: 'none', label: 'None' },
  { kind: 'basic', label: 'Basic' },
  { kind: 'bearer', label: 'Bearer Token' },
  { kind: 'apiKey', label: 'API Key' },
  { kind: 'oauth2', label: 'OAuth 2.0' },
  { kind: 'awsSigV4', label: 'AWS SigV4' },
];

type OAuth2Flow = 'clientCredentials' | 'authorizationCode' | 'authorizationCodePkce';

interface TokenState {
  result: OAuth2TokenResult | null;
  error: string | null;
  pending: boolean;
}

export function AuthTab(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const setAuth = useAppStore((s) => s.setAuth);
  const resolveInheritedAuth = useAppStore((s) => s.resolveInheritedAuth);

  const [inheritedAuth, setInheritedAuth] = useState<InheritedAuthInfo | null>(null);

  // Fetch inherited auth whenever the active tab or its relPath changes.
  const relPath = activeTab?.relPath ?? null;
  useEffect(() => {
    if (!relPath) {
      setInheritedAuth(null);
      return;
    }
    void resolveInheritedAuth(relPath).then(setInheritedAuth);
  }, [relPath, resolveInheritedAuth]);

  const [tokenState, setTokenState] = useState<TokenState>({
    result: null,
    error: null,
    pending: false,
  });
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  if (!activeTab) return <div />;
  const auth = activeTab.builder.auth;

  const changeType = (kind: AuthKind): void => {
    setAuth(defaultForType(kind));
    setTokenState({ result: null, error: null, pending: false });
    setDiscoveryError(null);
  };

  const hasInherited = inheritedAuth !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
          Type
        </span>
        <select
          value={auth.type}
          onChange={(e) => changeType(e.target.value as AuthKind)}
          className="field w-48 cursor-pointer"
        >
          {hasInherited && (
            <option value="none">Inherit ({inheritedAuth!.auth.type})</option>
          )}
          {AUTH_TYPES.filter((t) => hasInherited ? t.kind !== 'none' : true).map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {auth.type === 'none' && hasInherited && (
          <div className="mb-3 rounded-md border border-line bg-bg-subtle px-3 py-2 text-xs text-ink-3">
            Inherited from{' '}
            <span className="font-mono text-ink-2">
              /{inheritedAuth!.source}
            </span>
            . Set an explicit auth type above to override.
          </div>
        )}
        {auth.type === 'none' && !hasInherited && (
          <div className="text-xs text-ink-4">
            This request is sent without authentication.
          </div>
        )}

        {auth.type === 'basic' && (
          <div className="flex flex-col gap-3">
            <Row label="Username">
              <HiField
                value={auth.username}
                onChange={(v) => setAuth({ ...auth, username: v })}
                placeholder="admin"
              />
            </Row>
            <Row label="Password">
              <HiField
                value={auth.password}
                onChange={(v) => setAuth({ ...auth, password: v })}
                placeholder="{{password}}"
                password
              />
            </Row>
          </div>
        )}

        {auth.type === 'bearer' && (
          <Row label="Token">
            <HiField
              value={auth.token}
              onChange={(v) => setAuth({ ...auth, token: v })}
              placeholder="{{token}}"
            />
          </Row>
        )}

        {auth.type === 'apiKey' && (
          <div className="flex flex-col gap-3">
            <Row label="Key">
              <HiField
                value={auth.key}
                onChange={(v) => setAuth({ ...auth, key: v })}
                placeholder="X-Api-Key"
              />
            </Row>
            <Row label="Value">
              <HiField
                value={auth.value}
                onChange={(v) => setAuth({ ...auth, value: v })}
                placeholder="{{apiKey}}"
              />
            </Row>
            <Row label="Add to">
              <div className="flex gap-1">
                <RadioButton
                  active={auth.in === 'header'}
                  onClick={() => setAuth({ ...auth, in: 'header' })}
                >
                  Header
                </RadioButton>
                <RadioButton
                  active={auth.in === 'query'}
                  onClick={() => setAuth({ ...auth, in: 'query' })}
                >
                  Query
                </RadioButton>
              </div>
            </Row>
          </div>
        )}

        {auth.type === 'oauth2' && (
          <OAuth2Section
            auth={auth}
            setAuth={setAuth}
            tokenState={tokenState}
            setTokenState={setTokenState}
            discoveryLoading={discoveryLoading}
            setDiscoveryLoading={setDiscoveryLoading}
            discoveryError={discoveryError}
            setDiscoveryError={setDiscoveryError}
          />
        )}

        {auth.type === 'awsSigV4' && (
          <div className="flex flex-col gap-3">
            <Row label="Access key ID">
              <HiField
                value={auth.accessKeyId}
                onChange={(v) => setAuth({ ...auth, accessKeyId: v })}
                placeholder="{{awsAccessKeyId}}"
              />
            </Row>
            <Row label="Secret key">
              <HiField
                value={auth.secretAccessKey}
                onChange={(v) => setAuth({ ...auth, secretAccessKey: v })}
                placeholder="{{awsSecretKey}}"
                password
              />
            </Row>
            <Row label="Session token">
              <HiField
                value={auth.sessionToken ?? ''}
                onChange={(v) => setAuth({ ...auth, sessionToken: v })}
                placeholder="(optional)"
              />
            </Row>
            <Row label="Region">
              <HiField
                value={auth.region}
                onChange={(v) => setAuth({ ...auth, region: v })}
                placeholder="us-east-1"
              />
            </Row>
            <Row label="Service">
              <HiField
                value={auth.service}
                onChange={(v) => setAuth({ ...auth, service: v })}
                placeholder="s3"
              />
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuth2 section — extracted to keep the parent component readable.
// ---------------------------------------------------------------------------

interface OAuth2Auth {
  type: 'oauth2';
  flow: OAuth2Flow;
  tokenUrl: string;
  authUrl?: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  usePkce?: boolean;
  discoveryUrl?: string;
}

interface OAuth2SectionProps {
  auth: OAuth2Auth;
  setAuth: (auth: AuthConfig) => void;
  tokenState: TokenState;
  setTokenState: (s: TokenState) => void;
  discoveryLoading: boolean;
  setDiscoveryLoading: (v: boolean) => void;
  discoveryError: string | null;
  setDiscoveryError: (v: string | null) => void;
}

function OAuth2Section({
  auth,
  setAuth,
  tokenState,
  setTokenState,
  discoveryLoading,
  setDiscoveryLoading,
  discoveryError,
  setDiscoveryError,
}: OAuth2SectionProps): JSX.Element {
  const isAuthCode =
    auth.flow === 'authorizationCode' || auth.flow === 'authorizationCodePkce';

  const handleGetToken = (): void => {
    if (!isAuthCode) return;
    setTokenState({ result: null, error: null, pending: true });

    void window.scrapeman
      .oauth2StartAuthCodeFlow({
        authUrl: auth.authUrl ?? '',
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        ...(auth.clientSecret ? { clientSecret: auth.clientSecret } : {}),
        ...(auth.scope ? { scope: auth.scope } : {}),
        usePkce: auth.flow === 'authorizationCodePkce',
        ...(auth.audience ? { audience: auth.audience } : {}),
      })
      .then((result) => {
        setTokenState({ result, error: null, pending: false });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setTokenState({ result: null, error: msg, pending: false });
      });
  };

  const handleRefresh = (): void => {
    if (!tokenState.result?.refreshToken) return;
    // Re-trigger the IPC flow with the same config; the main process will
    // use the refresh token path when it finds one in the oauth2Client cache.
    setTokenState({ ...tokenState, pending: true, error: null });
    void window.scrapeman
      .oauth2StartAuthCodeFlow({
        authUrl: auth.authUrl ?? '',
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        ...(auth.clientSecret ? { clientSecret: auth.clientSecret } : {}),
        ...(auth.scope ? { scope: auth.scope } : {}),
        usePkce: auth.flow === 'authorizationCodePkce',
        ...(auth.audience ? { audience: auth.audience } : {}),
      })
      .then((result) => {
        setTokenState({ result, error: null, pending: false });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setTokenState({ result: null, error: msg, pending: false });
      });
  };

  const handleClearToken = (): void => {
    setTokenState({ result: null, error: null, pending: false });
  };

  const handleDiscover = (): void => {
    if (!auth.discoveryUrl) return;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    void window.scrapeman
      .oauth2Discover(auth.discoveryUrl)
      .then((doc) => {
        setAuth({
          ...auth,
          tokenUrl: doc.tokenUrl,
          authUrl: doc.authUrl,
        });
        setDiscoveryLoading(false);
      })
      .catch((err: unknown) => {
        setDiscoveryError(err instanceof Error ? err.message : String(err));
        setDiscoveryLoading(false);
      });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Flow */}
      <Row label="Flow">
        <select
          value={auth.flow}
          onChange={(e) =>
            setAuth({
              ...auth,
              flow: e.target.value as OAuth2Flow,
            })
          }
          className="field w-56 cursor-pointer"
        >
          <option value="clientCredentials">Client credentials</option>
          <option value="authorizationCode">Authorization code</option>
          <option value="authorizationCodePkce">Authorization code + PKCE</option>
        </select>
      </Row>

      {/* Discovery */}
      <Row label="Discovery URL">
        <div className="flex gap-2">
          <HiField
            value={auth.discoveryUrl ?? ''}
            onChange={(v) => setAuth({ ...auth, discoveryUrl: v })}
            placeholder="https://auth.example.com/.well-known/openid-configuration"
          />
          <button
            disabled={!auth.discoveryUrl || discoveryLoading}
            onClick={handleDiscover}
            className="shrink-0 rounded border border-line px-3 py-1 text-xs text-ink-3 hover:bg-bg-hover disabled:opacity-40"
          >
            {discoveryLoading ? 'Loading…' : 'Load'}
          </button>
        </div>
        {discoveryError && (
          <div className="mt-1 text-xs text-red-500">{discoveryError}</div>
        )}
      </Row>

      {/* Token URL */}
      <Row label="Token URL">
        <HiField
          value={auth.tokenUrl}
          onChange={(v) => setAuth({ ...auth, tokenUrl: v })}
          placeholder="https://auth.example.com/oauth/token"
        />
      </Row>

      {/* Auth URL — only for auth code flows */}
      {isAuthCode && (
        <Row label="Auth URL">
          <HiField
            value={auth.authUrl ?? ''}
            onChange={(v) => setAuth({ ...auth, authUrl: v })}
            placeholder="https://auth.example.com/oauth/authorize"
          />
        </Row>
      )}

      {/* Client ID */}
      <Row label="Client ID">
        <HiField
          value={auth.clientId}
          onChange={(v) => setAuth({ ...auth, clientId: v })}
          placeholder="{{oauthClientId}}"
        />
      </Row>

      {/* Client secret */}
      <Row label="Client secret">
        <HiField
          value={auth.clientSecret}
          onChange={(v) => setAuth({ ...auth, clientSecret: v })}
          placeholder={isAuthCode ? '(optional for PKCE)' : '{{oauthClientSecret}}'}
          password
        />
      </Row>

      {/* Scope */}
      <Row label="Scope">
        <HiField
          value={auth.scope ?? ''}
          onChange={(v) => setAuth({ ...auth, scope: v })}
          placeholder="read:things write:things"
        />
      </Row>

      {/* Audience */}
      <Row label="Audience">
        <HiField
          value={auth.audience ?? ''}
          onChange={(v) => setAuth({ ...auth, audience: v })}
          placeholder="(optional)"
        />
      </Row>

      {/* Redirect URI — shown read-only for auth code */}
      {isAuthCode && (
        <Row label="Redirect URI">
          <div className="field flex cursor-default items-center text-ink-4">
            http://127.0.0.1:&lt;port&gt;/callback (auto)
          </div>
        </Row>
      )}

      {/* Token panel — only for auth code flows */}
      {isAuthCode && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-bg-base p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-2">Token</span>
            {tokenState.result && (
              <ExpiryBadge expiresAt={tokenState.result.expiresAt} />
            )}
          </div>

          <div className="flex gap-2">
            <button
              disabled={tokenState.pending}
              onClick={handleGetToken}
              className="rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {tokenState.pending ? 'Authorizing…' : 'Get token'}
            </button>
            {tokenState.result?.refreshToken && (
              <button
                disabled={tokenState.pending}
                onClick={handleRefresh}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-3 hover:bg-bg-hover disabled:opacity-50"
              >
                Refresh
              </button>
            )}
            {tokenState.result && (
              <button
                onClick={handleClearToken}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-3 hover:bg-bg-hover"
              >
                Clear
              </button>
            )}
          </div>

          {tokenState.error && (
            <div className="text-xs text-red-500">{tokenState.error}</div>
          )}

          {tokenState.result && (
            <div className="mt-1 flex flex-col gap-1.5">
              {tokenState.result.accessToken && (
                <JwtInspector
                  label="Access token"
                  token={tokenState.result.accessToken}
                />
              )}
              {tokenState.result.idToken && (
                <JwtInspector
                  label="ID token"
                  token={tokenState.result.idToken}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expiry badge with live countdown
// ---------------------------------------------------------------------------

function ExpiryBadge({ expiresAt }: { expiresAt: number }): JSX.Element {
  const [label, setLabel] = useState<string>(() => formatExpiry(expiresAt));

  useEffect(() => {
    if (expiresAt === Number.MAX_SAFE_INTEGER) return;
    const interval = setInterval(() => {
      setLabel(formatExpiry(expiresAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isExpired = expiresAt !== Number.MAX_SAFE_INTEGER && expiresAt < Date.now();
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isExpired ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
      }`}
    >
      {label}
    </span>
  );
}

function formatExpiry(expiresAt: number): string {
  if (expiresAt === Number.MAX_SAFE_INTEGER) return 'no expiry';
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'expired';
  const s = Math.floor(remaining / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `expires in ${h}h ${m % 60}m`;
  if (m > 0) return `expires in ${m}m ${s % 60}s`;
  return `expires in ${s}s`;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 shrink-0 text-xs text-ink-3">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function HiField({
  value,
  onChange,
  placeholder,
  password,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  password?: boolean;
}): JSX.Element {
  return (
    <CellContextMenu value={value} onChange={onChange}>
      <div>
        <HighlightedInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(placeholder !== undefined ? { placeholder } : {})}
          variant="field"
          {...(password ? { type: 'password' as const } : {})}
        />
      </div>
    </CellContextMenu>
  );
}

function RadioButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs font-medium ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-bg-canvas text-ink-3 hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

function defaultForType(kind: AuthKind): AuthConfig {
  switch (kind) {
    case 'none':
      return { type: 'none' };
    case 'basic':
      return { type: 'basic', username: '', password: '' };
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'apiKey':
      return { type: 'apiKey', key: '', value: '', in: 'header' };
    case 'oauth2':
      return {
        type: 'oauth2',
        flow: 'clientCredentials',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
      };
    case 'awsSigV4':
      return {
        type: 'awsSigV4',
        accessKeyId: '',
        secretAccessKey: '',
        region: 'us-east-1',
        service: 's3',
      };
  }
}
