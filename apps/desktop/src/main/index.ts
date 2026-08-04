import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import { appendFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppStore } from "./store.js";
import { TaskRunner } from "./task-runner.js";
import { HarvesterManager } from "./harvester-manager.js";
import { ChallengeBroker } from "./challenge-broker.js";
import { activate, deactivate, heartbeat, resume } from "./license-client.js";
import { UpdateController } from "./updater.js";
import { MonitorClient } from "./monitor-client.js";
import { sendTestWebhook, validateWebhookUrl } from "./webhook-notifier.js";
import type { WebhookSettings } from "../shared/types.js";
import { validateAppData } from "../shared/backup.js";
import { proxyTestTargetUrl, testProxies, testProxy } from "./proxy-tester.js";
import { PokemonCenterProbe } from "./pokemon-center-probe.js";

let mainWindow: BrowserWindow | null = null;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const recordLaunch = (stage: string, details: Record<string, unknown> = {}) => {
  const probe = process.env.BRAVA_LAUNCH_PROBE;
  if (!probe) return;
  appendFileSync(probe, `${JSON.stringify({ stage, at: new Date().toISOString(), pid: process.pid, ...details })}\n`, "utf8");
};
app.setName("Brava");
const bravaUserData = process.env.BRAVA_USER_DATA ?? join(app.getPath("appData"), "Brava");
const legacyUserData = join(app.getPath("appData"), "Car" + "dinal");
if (!process.env.BRAVA_USER_DATA && !existsSync(bravaUserData) && existsSync(legacyUserData)) {
  cpSync(legacyUserData, bravaUserData, { recursive: true });
}
mkdirSync(bravaUserData, { recursive: true });
app.setPath("userData", bravaUserData);
app.setAppUserModelId("com.brava.companion");
recordLaunch("profile-ready", { userData: app.getPath("userData") });
// Some Windows 10 graphics stacks terminate Electron's sandboxed GPU child with
// 0xC0000135 before the renderer can load. Keep acceleration enabled and use the
// narrower GPU-sandbox compatibility switch; renderer sandboxing remains on.
app.commandLine.appendSwitch("disable-gpu-sandbox");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 460, height: 460, minWidth: 460, minHeight: 460,
    resizable: false, maximizable: false,
    backgroundColor: "#070a11", frame: false,
    icon: join(moduleDirectory, "../../build/icon-large-v3.png"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(moduleDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // This window only loads packaged local files. Windows 10 on affected
      // systems otherwise rejects the renderer child at launch (exit 49).
      sandbox: false,
    },
  });
  recordLaunch("window-created");
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    recordLaunch("window-visible", { visible: mainWindow?.isVisible() ?? false });
  });
  mainWindow.webContents.once("did-start-loading", () => recordLaunch("renderer-started"));
  mainWindow.webContents.once("did-finish-load", () => recordLaunch("renderer-loaded"));
  mainWindow.webContents.once("did-fail-load", (_event, code, description, url) => {
    recordLaunch("renderer-load-failed", { code, description, url });
  });
  mainWindow.webContents.once("render-process-gone", (_event, details) => {
    recordLaunch("renderer-process-gone", { reason: details.reason, exitCode: details.exitCode });
  });
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized", false));
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(moduleDirectory, "../renderer/index.html"));
}

if (!hasSingleInstanceLock) {
  recordLaunch("single-instance-exit");
  app.quit();
} else app.whenReady().then(async () => {
  recordLaunch("app-ready");
  const store = new AppStore();
  const runner = new TaskRunner(store, () => mainWindow);
  const productProbe = new PokemonCenterProbe();
  runner.setProductProbe((sku) => productProbe.lookup(sku));
  await runner.recover();
  const harvesters = new HarvesterManager(store, () => mainWindow);
  const challenges = new ChallengeBroker(store, () => mainWindow, harvesters, {
    testMode: !app.isPackaged && process.env.BRAVA_CHALLENGE_TEST_MODE === "1",
  });
  runner.setChallengeHandlers({
    request: (taskId, challengeUrl) => challenges.request(taskId, 0, challengeUrl),
    cancel: (taskId) => challenges.cancelTask(taskId),
  });
  harvesters.setLifecycleHandlers({
    onAvailable: () => challenges.dispatch(),
    onClosed: (harvesterId, redistribute) => challenges.releaseHarvester(harvesterId, redistribute),
    onSolved: (harvesterId) => challenges.solve(harvesterId),
  });
  await challenges.recover();
  const updater = new UpdateController(() => mainWindow);
  const monitor = new MonitorClient(() => mainWindow, (signal) => runner.handleProductSignal(signal));
  app.once("before-quit", (event) => {
    event.preventDefault();
    challenges.shutdown();
    productProbe.close();
    void runner.shutdown().finally(() => app.quit());
  });
  ipcMain.handle("clipboard:write-text", (_event, value: string) => {
    if (typeof value !== "string" || value.length > 10_000) throw new Error("Invalid clipboard value.");
    clipboard.writeText(value);
  });
  ipcMain.handle("external:open-order-status", () => shell.openExternal("https://www.pokemoncenter.com/orders"));
  ipcMain.handle("window:set-mode", async (_event, mode: "activation" | "workspace") => {
    if (!mainWindow || (mode !== "activation" && mode !== "workspace")) return;
    if (mode === "activation") {
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(true);
      if (mainWindow.isMaximized()) {
        await new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 250);
          mainWindow?.once("unmaximize", () => { clearTimeout(fallback); resolve(); });
          mainWindow?.unmaximize();
        });
      }
      mainWindow.setMinimumSize(460, 460);
      mainWindow.setSize(460, 460, false);
      mainWindow.center();
      mainWindow.setMaximizable(false);
      mainWindow.setResizable(false);
    } else {
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(true);
      mainWindow.setMinimumSize(1240, 720);
      mainWindow.setSize(1280, 820, true);
      mainWindow.center();
    }
    const [width, height] = mainWindow.getSize();
    recordLaunch("window-mode", { mode, width, height });
  });
  ipcMain.handle("window:minimize", () => { mainWindow?.minimize(); });
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => { mainWindow?.close(); });
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle("data:load", () => store.load());
  ipcMain.handle("data:save", (_event, data) => store.save(validateAppData(data)));
  ipcMain.handle("license:device", async () => ({ deviceId: await store.getDeviceId(), deviceName: hostname() }));
  ipcMain.handle("license:resume", (_event, apiUrl: string) => resume(store, apiUrl));
  ipcMain.handle("license:activate", (_event, key: string, apiUrl: string) => activate(store, key, apiUrl));
  ipcMain.handle("license:heartbeat", (_event, apiUrl: string) => heartbeat(apiUrl));
  ipcMain.handle("license:deactivate", async (_event, apiUrl: string) => { await deactivate(store, apiUrl); monitor.disconnect(); });
  ipcMain.handle("license:key", () => store.getLicenseKey());
  ipcMain.handle("license:copy-key", async () => {
    const key = await store.getLicenseKey();
    if (!key) return false;
    clipboard.writeText(key);
    return true;
  });
  ipcMain.handle("webhook:get", () => store.getWebhookSettings());
  ipcMain.handle("webhook:save", (_event, settings: WebhookSettings) => {
    if (settings.successUrl.trim()) validateWebhookUrl(settings.successUrl.trim());
    if (settings.declineUrl.trim()) validateWebhookUrl(settings.declineUrl.trim());
    return store.setWebhookSettings(settings);
  });
  ipcMain.handle("webhook:test", (_event, kind: "success" | "decline") => {
    if (kind !== "success" && kind !== "decline") throw new Error("Unknown webhook type.");
    return sendTestWebhook(store, kind);
  });
  ipcMain.handle("proxy:test", async (_event, id: string, target: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid proxy id.");
    const proxy = (await store.load()).proxies.find((item) => item.id === id);
    if (!proxy) throw new Error("Proxy not found.");
    return testProxy(proxy, { target: proxyTestTargetUrl(target) });
  });
  ipcMain.handle("proxy:test-many", async (_event, ids: string[], target: unknown) => {
    if (!Array.isArray(ids) || ids.length > 50_000 || ids.some((id) => typeof id !== "string")) throw new Error("Invalid proxy list.");
    const requested = new Set(ids);
    const proxies = (await store.load()).proxies.filter((proxy) => requested.has(proxy.id));
    return testProxies(proxies, { target: proxyTestTargetUrl(target) });
  });
  ipcMain.handle("task:start", (_event, id: string) => runner.start(id));
  ipcMain.handle("task:start-many", (_event, ids: string[]) => runner.startMany(ids));
  ipcMain.handle("task:stop", (_event, id: string) => runner.stop(id));
  ipcMain.handle("task:stop-many", (_event, ids: string[]) => runner.stopMany(ids));
  ipcMain.handle("task:review", (_event, id: string) => runner.review(id));
  ipcMain.handle("task:complete", (_event, id: string) => runner.complete(id));
  ipcMain.handle("task:decline", (_event, id: string) => runner.decline(id));
  ipcMain.handle("task:carted", (_event, id: string) => runner.markCarted(id));
  ipcMain.handle("task:update-sku", (_event, id: string, sku: string) => runner.updateSku(id, sku));
  ipcMain.handle("task:apply-monitor-signal", (_event, id: string) => runner.applyMonitorSignal(id));
  ipcMain.handle("task:refresh-queue", (_event, id: string) => runner.refreshQueue(id));
  ipcMain.handle("monitor:connect", (_event, apiUrl: string) => monitor.connect(apiUrl));
  ipcMain.handle("monitor:disconnect", () => monitor.disconnect());
  ipcMain.handle("monitor:refresh", () => monitor.refresh());
  ipcMain.handle("monitor:state", () => monitor.state());
  ipcMain.handle("harvester:open", (_event, id: string) => harvesters.open(id));
  ipcMain.handle("harvester:close", (_event, id: string) => harvesters.close(id));
  ipcMain.handle("harvester:open-all", () => harvesters.openAll());
  ipcMain.handle("harvester:close-all", () => harvesters.closeAll());
  ipcMain.handle("harvester:reload-captcha", (_event, id: string) => harvesters.reloadCaptcha(id));
  ipcMain.handle("harvester:test-captcha", (_event, id: string) => harvesters.testCaptcha(id));
  ipcMain.handle("harvester:mark-solved", (_event, id: string) => challenges.solve(id));
  ipcMain.handle("update:state", () => updater.state());
  ipcMain.handle("update:check", () => updater.check());
  ipcMain.handle("update:download", () => updater.download());
  ipcMain.handle("update:install", () => updater.install());
  createWindow();
  mainWindow?.once("closed", () => {
    mainWindow = null;
    void harvesters.closeAll();
  });
  mainWindow?.webContents.once("did-finish-load", () => {
    setTimeout(() => void updater.check(), 2_500);
    setTimeout(() => void harvesters.openOnLaunch(), 800);
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
