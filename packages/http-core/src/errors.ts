export type ExecutorErrorKind =
  | 'network'
  | 'timeout'
  | 'tls'
  | 'protocol'
  | 'aborted'
  | 'invalid-request'
  | 'unknown';

export class ExecutorError extends Error {
  readonly kind: ExecutorErrorKind;
  override readonly cause?: unknown;

  constructor(kind: ExecutorErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExecutorError';
    this.kind = kind;
    if (cause !== undefined) this.cause = cause;
  }
}
