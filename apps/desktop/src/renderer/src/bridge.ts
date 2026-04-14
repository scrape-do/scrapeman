import type { ScrapemanBridge } from '@scrapeman/shared-types';

declare global {
  interface Window {
    scrapeman: ScrapemanBridge | undefined;
  }
}

if (!window.scrapeman) {
  // Surface a visible error instead of silently crashing the React tree.
  // This typically means the preload script failed to load — check the main
  // process console and make sure out/preload/index.mjs exists.
  const message =
    'Preload bridge missing: window.scrapeman is undefined. The preload script did not run.';
  document.body.innerHTML = `
    <div style="padding:24px;font-family:ui-monospace,Menlo,monospace;color:#fda4af;background:#0b0d10;min-height:100vh;">
      <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#f87171;margin-bottom:8px;">
        scrapeman startup error
      </div>
      <div style="font-size:13px;line-height:1.5;">${message}</div>
      <div style="margin-top:12px;font-size:11px;color:#737373;">
        Open DevTools (⌘⌥I) and check the main process terminal for preload errors.
      </div>
    </div>
  `;
  throw new Error(message);
}

export const bridge: ScrapemanBridge = window.scrapeman;
