import { useMemo } from 'react';
import { useAppStore } from '../store.js';

export interface AvailableVariable {
  name: string;
  kind: 'env' | 'builtin';
  preview: string;
}

const BUILTINS: AvailableVariable[] = [
  { name: 'random', kind: 'builtin', preview: 'fresh UUID per request' },
  { name: 'uuid', kind: 'builtin', preview: 'alias of random' },
  { name: 'timestamp', kind: 'builtin', preview: 'epoch milliseconds' },
  { name: 'timestampSec', kind: 'builtin', preview: 'epoch seconds' },
  { name: 'isoDate', kind: 'builtin', preview: 'ISO 8601 datetime' },
  { name: 'randomInt', kind: 'builtin', preview: '0 — 999999' },
];

export function useAvailableVariables(): AvailableVariable[] {
  const environments = useAppStore((s) => s.environments);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);

  return useMemo(() => {
    const env = activeEnvironment
      ? environments.find((e) => e.name === activeEnvironment)
      : null;
    const envVars: AvailableVariable[] =
      env?.variables
        .filter((v) => v.enabled && v.key.trim())
        .map((v) => ({
          name: v.key,
          kind: 'env' as const,
          preview: v.secret ? '••••••' : v.value,
        })) ?? [];
    return [...envVars, ...BUILTINS];
  }, [environments, activeEnvironment]);
}
