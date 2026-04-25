import vm from 'node:vm';
import type { ScriptConsoleEntry, ScriptAssertionFailure } from '@scrapeman/shared-types';

export interface SandboxContext {
  [key: string]: unknown;
}

export interface ScriptRunOptions {
  /** Timeout in ms before the script is forcibly killed. Default: 5000. */
  timeoutMs?: number;
}

export interface ScriptRunResult {
  consoleEntries: ScriptConsoleEntry[];
  failedAssertions: ScriptAssertionFailure[];
  durationMs: number;
}

/**
 * Runs user-provided JavaScript in a Node vm context.
 *
 * The context receives exactly what the caller injects — no `require`,
 * `process`, or `import` are available. Async scripts are supported: the
 * code is wrapped in `(async () => { <user code> })()` and the returned
 * Promise is awaited.
 *
 * A single-trust boundary applies: the user runs this app on their own
 * machine and writes their own scripts. The vm module is not a security
 * boundary; it exists to provide a scoped API surface, not to isolate
 * untrusted third-party code.
 */
export async function runScript(
  code: string,
  context: SandboxContext,
  options: ScriptRunOptions = {},
): Promise<ScriptRunResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const consoleEntries: ScriptConsoleEntry[] = [];
  const failedAssertions: ScriptAssertionFailure[] = [];

  // Build the console shim — each method appends to the entries array.
  const consoleSandbox = {
    log: makeConsoleFn('log', consoleEntries),
    info: makeConsoleFn('info', consoleEntries),
    warn: makeConsoleFn('warn', consoleEntries),
    error: makeConsoleFn('error', consoleEntries),
  };

  // Minimal test/expect API. `test(name, fn)` runs fn immediately (no
  // async test queue — scripts are sequential). expect(value).toBe(x)
  // appends to failedAssertions on mismatch.
  function test(name: string, fn: () => void | Promise<void>): void | Promise<void> {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          failedAssertions.push({ name, message });
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedAssertions.push({ name, message });
    }
  }

  function expect(actual: unknown) {
    return {
      toBe(expected: unknown) {
        if (actual !== expected) {
          throw new Error(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
        }
      },
      toEqual(expected: unknown) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(
            `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
          );
        }
      },
      toBeTruthy() {
        if (!actual) {
          throw new Error(`Expected ${JSON.stringify(actual)} to be truthy`);
        }
      },
      toBeFalsy() {
        if (actual) {
          throw new Error(`Expected ${JSON.stringify(actual)} to be falsy`);
        }
      },
      toContain(expected: unknown) {
        if (typeof actual === 'string' && typeof expected === 'string') {
          if (!actual.includes(expected)) {
            throw new Error(`Expected "${actual}" to contain "${expected}"`);
          }
          return;
        }
        if (Array.isArray(actual)) {
          if (!actual.includes(expected)) {
            throw new Error(`Expected array to contain ${JSON.stringify(expected)}`);
          }
          return;
        }
        throw new Error(`toContain requires a string or array`);
      },
    };
  }

  const sandboxBase: Record<string, unknown> = {
    console: consoleSandbox,
    test,
    expect,
    // Allow setTimeout/clearTimeout so scripts can use simple delays.
    // For the vm timeout to work correctly these must be the real Node ones.
    setTimeout,
    clearTimeout,
    // Provide JSON, which is commonly expected in sandbox environments.
    JSON,
    Math,
    Date,
    ...context,
  };

  vm.createContext(sandboxBase);

  // Wrap in async IIFE so the user can use `await` at the top level.
  const wrapped = `(async () => {\n${code}\n})()`;

  const startNs = process.hrtime.bigint();
  try {
    const script = new vm.Script(wrapped, { filename: 'user-script.js' });
    const promise = script.runInContext(sandboxBase as vm.Context, {
      timeout: timeoutMs,
    });
    if (promise instanceof Promise) {
      await promise;
    }
  } catch (err) {
    // Timeout throws "Script execution timed out after Xms" — surface it
    // as a console error so the user sees it in the console panel.
    const message = err instanceof Error ? err.message : String(err);
    consoleEntries.push({
      level: 'error',
      args: [`Script error: ${message}`],
      timestamp: Date.now(),
    });
  }
  const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

  return { consoleEntries, failedAssertions, durationMs };
}

function makeConsoleFn(
  level: ScriptConsoleEntry['level'],
  entries: ScriptConsoleEntry[],
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    entries.push({ level, args, timestamp: Date.now() });
  };
}
