// PICTURE_TO_PAGE_PLAN step 1: render the true pages to the pictures the agent is given, and later the agent's pages
// beside them. Electron (the client's), a hidden window, one PNG per page:
//   env -u ELECTRON_RUN_AS_NODE shell/node_modules/electron/dist/electron.exe docs/spike/ide/pictures/render.js <page.html> <out.png> [W H]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [page, out, w = '1024', h = '640'] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/render\.js$/.test(a) && a !== '.');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: Number(w), height: Number(h), useContentSize: true, webPreferences: { offscreen: false } });
    await win.loadFile(path.resolve(page));
    // A three.js page sets window.__rendered after its first frame; a plain page is ready once loaded.
    for (let i = 0; i < 50; i++) {
        if (await win.webContents.executeJavaScript('document.readyState === "complete" && (window.__rendered !== false)')) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 500));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    console.log(out, img.getSize());
    app.quit();
});
