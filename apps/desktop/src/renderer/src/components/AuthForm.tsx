/**
 * A controlled auth form, used by collection and folder settings dialogs.
 * Mirrors the shape of AuthTab but takes explicit `auth` + `onChange` props
 * instead of reading from the active request tab.
 */
import type { AuthConfig } from '@scrapeman/shared-types';
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

export function AuthForm({
  auth,
  onChange,
}: {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}): JSX.Element {
  const changeType = (kind: AuthKind): void => {
    onChange(defaultForType(kind));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
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

      <div>
        {auth.type === 'none' && (
          <div className="text-xs text-ink-4">
            No default auth. Requests use their own auth settings.
          </div>
        )}

        {auth.type === 'basic' && (
          <div className="flex flex-col gap-3">
            <Row label="Username">
              <HiField
                value={auth.username}
                onChange={(v) => onChange({ ...auth, username: v })}
                placeholder="admin"
              />
            </Row>
            <Row label="Password">
              <HiField
                value={auth.password}
                onChange={(v) => onChange({ ...auth, password: v })}
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
              onChange={(v) => onChange({ ...auth, token: v })}
              placeholder="{{token}}"
            />
          </Row>
        )}

        {auth.type === 'apiKey' && (
          <div className="flex flex-col gap-3">
            <Row label="Key">
              <HiField
                value={auth.key}
                onChange={(v) => onChange({ ...auth, key: v })}
                placeholder="X-Api-Key"
              />
            </Row>
            <Row label="Value">
              <HiField
                value={auth.value}
                onChange={(v) => onChange({ ...auth, value: v })}
                placeholder="{{apiKey}}"
              />
            </Row>
            <Row label="Add to">
              <div className="flex gap-1">
                <RadioButton
                  active={auth.in === 'header'}
                  onClick={() => onChange({ ...auth, in: 'header' })}
                >
                  Header
                </RadioButton>
                <RadioButton
                  active={auth.in === 'query'}
                  onClick={() => onChange({ ...auth, in: 'query' })}
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
                  onChange({
                    ...auth,
                    flow: e.target.value as
                      | 'clientCredentials'
                      | 'authorizationCode',
                  })
                }
                className="field w-48 cursor-pointer"
              >
                <option value="clientCredentials">Client credentials</option>
                <option value="authorizationCode">Authorization code</option>
              </select>
            </Row>
            <Row label="Token URL">
              <HiField
                value={auth.tokenUrl}
                onChange={(v) => onChange({ ...auth, tokenUrl: v })}
                placeholder="https://auth.example.com/oauth/token"
              />
            </Row>
            <Row label="Client ID">
              <HiField
                value={auth.clientId}
                onChange={(v) => onChange({ ...auth, clientId: v })}
                placeholder="{{oauthClientId}}"
              />
            </Row>
            <Row label="Client secret">
              <HiField
                value={auth.clientSecret}
                onChange={(v) => onChange({ ...auth, clientSecret: v })}
                placeholder="{{oauthClientSecret}}"
                password
              />
            </Row>
            <Row label="Scope">
              <HiField
                value={auth.scope ?? ''}
                onChange={(v) => onChange({ ...auth, scope: v })}
                placeholder="read:things write:things"
              />
            </Row>
          </div>
        )}

        {auth.type === 'awsSigV4' && (
          <div className="flex flex-col gap-3">
            <Row label="Access key ID">
              <HiField
                value={auth.accessKeyId}
                onChange={(v) => onChange({ ...auth, accessKeyId: v })}
                placeholder="{{awsAccessKeyId}}"
              />
            </Row>
            <Row label="Secret key">
              <HiField
                value={auth.secretAccessKey}
                onChange={(v) => onChange({ ...auth, secretAccessKey: v })}
                placeholder="{{awsSecretKey}}"
                password
              />
            </Row>
            <Row label="Region">
              <HiField
                value={auth.region}
                onChange={(v) => onChange({ ...auth, region: v })}
                placeholder="us-east-1"
              />
            </Row>
            <Row label="Service">
              <HiField
                value={auth.service}
                onChange={(v) => onChange({ ...auth, service: v })}
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
