// Run under Electron against the bundled local fixture. Never opens a store.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const output = mkdtempSync(join(tmpdir(), "brava-cart-debug-smoke-"));
app.setPath("userData", join(output, "profile"));
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.whenReady().then(async () => {
  const browser = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { sandbox: false, backgroundThrottling: false } });
  try {
    await browser.loadFile(resolve(process.argv[2]));
    await browser.webContents.executeJavaScript(`new Promise((resolve, reject) => { let tries = 0; const timer = setInterval(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Run cart-only test'); if (button) { clearInterval(timer); button.click(); resolve(true); } else if (++tries > 50) { clearInterval(timer); reject(new Error('Viewer did not render')); } }, 100); })`);
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
    const result = await browser.webContents.executeJavaScript(`({ imageLoaded: !!document.querySelector('.cart-debug-preview img')?.naturalWidth, dialog: !!document.querySelector('[aria-label="Cart-only debug viewer"]'), overflow: document.documentElement.scrollWidth > innerWidth })`);
    if (!result.imageLoaded || !result.dialog || result.overflow) throw new Error(JSON.stringify(result));
    await browser.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
    const image = await browser.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    if (image.isEmpty() || browser.isVisible()) throw new Error("Hidden capture failed or browser became visible");
    writeFileSync(join(output, "viewer.png"), image.toPNG());
    await browser.webContents.executeJavaScript(`document.querySelector('[aria-label="Close debug viewer"]').click()`);
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    if (!(await browser.webContents.executeJavaScript(`document.body.dataset.closed === 'true'`))) throw new Error("Close handler failed");
    console.log(`Cart debug hidden-window/UI smoke passed: ${join(output, "viewer.png")}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { browser.destroy(); app.exit(process.exitCode || 0); }
});
