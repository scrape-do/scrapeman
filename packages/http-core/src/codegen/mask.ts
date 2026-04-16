/**
 * Partially masks a secret value for safe display in code export.
 * Shows the first 4 and last 2 characters with *** in between.
 * Short values (6 chars or fewer) are fully replaced with ***.
 */
export function maskSecret(value: string): string {
  if (value.length <= 6) return '***';
  return value.slice(0, 4) + '***' + value.slice(-2);
}
