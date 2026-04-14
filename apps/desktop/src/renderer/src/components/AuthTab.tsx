import type { AuthConfig } from '@scrapeman/shared-types';
import { useAppStore } from '../store.js';
import { HighlightedInput } from '../ui/HighlightedInput.js';
import { CellContextMenu } from '../ui/CellContextMenu.js';

type AuthKind = AuthConfig['type'];

const AUTH_TYPES: Array<{ kind: AuthKind; label: string }> = [
  { kind: 'none', label: 'None' },
  { kind: 'basic', label: 'Basic' },
  { kind: 'bearer', label: 'Bearer Token' },
  { kind: 'apiKey', label: 'API Key' },
  { kind: 'oauth2', label: 'OAuth 2.0' },
  { kind: 'awsSigV4', label: 'AWS SigV4' },
];

export function AuthTab(): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const setAuth = useAppStore((s) => s.setAuth);

  if (!activeTab) return <div />;
  const auth = activeTab.builder.auth;

  const changeType = (kind: AuthKind): void => {
    setAuth(defaultForType(kind));
  };

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
          {AUTH_TYPES.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {auth.type === 'none' && (
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
          <div className="flex flex-col gap-3">
            <Row label="Flow">
              <select
                value={auth.flow}
                onChange={(e) =>
                  setAuth({
                    ...auth,
                    flow: e.target.value as 'clientCredentials' | 'authorizationCode',
                  })
                }
                className="field w-48 cursor-pointer"
              >
                <option value="clientCredentials">Client credentials</option>
                <option value="authorizationCode">
                  Authorization code (coming soon)
                </option>
              </select>
            </Row>
            <Row label="Token URL">
              <HiField
                value={auth.tokenUrl}
                onChange={(v) => setAuth({ ...auth, tokenUrl: v })}
                placeholder="https://auth.example.com/oauth/token"
              />
            </Row>
            <Row label="Client ID">
              <HiField
                value={auth.clientId}
                onChange={(v) => setAuth({ ...auth, clientId: v })}
                placeholder="{{oauthClientId}}"
              />
            </Row>
            <Row label="Client secret">
              <HiField
                value={auth.clientSecret}
                onChange={(v) => setAuth({ ...auth, clientSecret: v })}
                placeholder="{{oauthClientSecret}}"
                password
              />
            </Row>
            <Row label="Scope">
              <HiField
                value={auth.scope ?? ''}
                onChange={(v) => setAuth({ ...auth, scope: v })}
                placeholder="read:things write:things"
              />
            </Row>
            <Row label="Audience">
              <HiField
                value={auth.audience ?? ''}
                onChange={(v) => setAuth({ ...auth, audience: v })}
                placeholder="(optional)"
              />
            </Row>
          </div>
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
