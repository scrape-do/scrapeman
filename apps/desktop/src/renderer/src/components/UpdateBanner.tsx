import { useAppStore } from '../store.js';
import { bridge } from '../bridge.js';

export function UpdateBanner(): JSX.Element | null {
  const updateInfo = useAppStore((s) => s.updateInfo);
  const dismissedVersions = useAppStore((s) => s.dismissedVersions);
  const dismissUpdate = useAppStore((s) => s.dismissUpdate);

  if (!updateInfo || dismissedVersions.includes(updateInfo.version)) return null;

  return (
    <div className="flex h-8 items-center justify-center gap-3 bg-accent/10 px-4 text-xs text-accent">
      <span>Scrapeman v{updateInfo.version} is available</span>
      <button
        onClick={() => bridge.openReleasePage(updateInfo.releaseUrl)}
        className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-white hover:bg-accent/90"
        title="Download update"
      >
        Download
      </button>
      <button
        onClick={() => dismissUpdate(updateInfo.version)}
        className="ml-1 text-accent/60 hover:text-accent"
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
