export type Platform = 'darwin' | 'win32' | 'linux' | 'unknown';

export function usePlatform(): Platform {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'darwin';
  if (/Windows/i.test(ua)) return 'win32';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}
