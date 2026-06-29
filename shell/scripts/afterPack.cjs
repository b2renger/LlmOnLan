// electron-builder afterPack hook — macOS only.
//
// Ad-hoc code-signs the packaged .app (`codesign --sign -`) so Apple Silicon
// doesn't report the unsigned app as "damaged". Not notarized → first launch
// still shows the gentler "unidentified developer" prompt (right-click → Open).
// electron-builder's own signing is disabled (identity:null) so this is the one
// signing step we control. No-op on Windows/Linux.

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    try {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        console.log(`[afterPack] ad-hoc signed ${appPath}`);
    } catch (e) {
        console.warn(`[afterPack] codesign failed (continuing): ${e.message}`);
    }
};
