// Ad-hoc sign the packed .app on macOS so Apple Silicon (Big Sur+) lets
// it launch without the "damaged" error. electron-builder doesn't have a
// native ad-hoc mode (passing `-` as identity makes it look up a real
// keychain entry), so we run codesign manually here.
//
// Notarization still isn't done — users see "unidentified developer" on
// first run and need right-click → Open. Code signing with a real
// Developer ID + notarization is the M10 release polish task.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log(`[after-pack] ad-hoc signing ${appPath}`);
  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
      { stdio: 'inherit' },
    );
    // Verify the signature is in place.
    execFileSync('codesign', ['--verify', '--verbose=2', appPath], {
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[after-pack] codesign failed:', err);
    throw err;
  }
};
