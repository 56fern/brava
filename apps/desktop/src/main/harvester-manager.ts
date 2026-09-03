import { BrowserWindow, screen } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStore } from "./store.js";
import { CheckoutAutomation } from "./checkout-automation.js";
import type { CheckoutOutcome } from "./checkout-automation.js";
import type { Harvester, HarvesterStatus, Task } from "../shared/types.js";
import { buildCheckoutFields } from "../shared/checkout-scripts.js";
import { parseHarvesterProxy } from "../shared/harvester-proxy.js";

const officialHosts = new Set(["pokemoncenter.com", "www.pokemoncenter.com"]);
const harvesterIconPath = (() => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resourcesPath
    ? join(resourcesPath, "app.asar", "build", "icon-large-v3.png")
    : fileURLToPath(new URL("../../build/icon-large-v3.png", import.meta.url));
})();
const harvesterLogoDataUrl = `data:image/png;base64,${readFileSync(harvesterIconPath).toString("base64")}`;
const challengeOnlyCss = `
  html, body { min-height: 100% !important; background: #080d15 !important; }
  body > * { visibility: hidden !important; }
  body::before {
    content: "Preparing CAPTCHA…";
    visibility: visible !important;
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: grid;
    place-items: center;
    color: #a8bad0;
    background: #080d15;
    font: 600 14px system-ui, sans-serif;
  }
  body:has(iframe[src*="hcaptcha"], iframe[title*="hCaptcha"], .h-captcha, [data-sitekey])::before { display: none !important; }
  iframe[src*="hcaptcha"], iframe[title*="hCaptcha"], .h-captcha, [data-sitekey],
  iframe[src*="hcaptcha"] *, iframe[title*="hCaptcha"] *, .h-captcha *, [data-sitekey] * {
    visibility: visible !important;
  }
  iframe[src*="hcaptcha"], iframe[title*="hCaptcha"], .h-captcha, [data-sitekey] {
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    max-height: 100vh !important;
    margin: 0 !important;
    background: #080d15 !important;
  }
`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const waitingPage = (name: string) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:center;color:#dbe8f6;background:radial-gradient(circle at 50% 35%,#10233a 0,#080d15 48%,#05080d 100%);font-family:Inter,system-ui,sans-serif}.card{width:min(330px,calc(100vw - 40px));padding:34px 28px;text-align:center;border:1px solid #1e3955;border-radius:16px;background:#0b1420;box-shadow:0 24px 70px #0008}.mark{width:58px;height:58px;display:grid;place-items:center;margin:0 auto 18px;border:1px solid #265a86;border-radius:16px;background:linear-gradient(145deg,#102b46,#091725);box-shadow:inset 0 1px #ffffff0b,0 10px 28px #0005}.mark img{width:47px;height:47px;display:block;object-fit:contain;filter:drop-shadow(0 5px 11px #0008)}.eyebrow{color:#5caefa;font:700 10px/1.2 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase}h1{margin:10px 0 8px;font-size:22px}p{margin:0;color:#8295aa;font-size:12px;line-height:1.6}.dot{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:#45d3a0;box-shadow:0 0 14px #45d3a0}</style></head><body><main class="card"><div class="mark"><img src="${harvesterLogoDataUrl}" alt="Brava"></div><span class="eyebrow">${escapeHtml(name)}</span><h1><span class="dot"></span>Waiting for CAPTCHA</h1><p>This window stays idle until a task sends a CAPTCHA challenge.</p></main></body></html>`)}`;

export function harvesterBounds(index: number, workArea: Electron.Rectangle): Electron.Rectangle {
  const gap = 12;
  const margin = 18;
  const width = Math.min(430, Math.max(360, workArea.width - margin * 2));
  const height = Math.min(720, Math.max(520, workArea.height - margin * 2));
  const columns = Math.max(1, Math.floor((workArea.width - margin * 2 + gap) / (width + gap)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const cascade = row * 28;
  return {
    x: Math.max(workArea.x + margin, workArea.x + workArea.width - margin - width - column * (width + gap) - cascade),
    y: Math.min(workArea.y + workArea.height - height - margin, workArea.y + margin + cascade),
    width,
    height,
  };
}

export function permitsChallengeNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && officialHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export class HarvesterManager {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly assignedChallengeUrls = new Map<string, string>();
  private readonly solveWatchers = new Map<string, NodeJS.Timeout>();
  private readonly insertedCss = new Map<string, string>();
  private closingAll = false;
  private onAvailable: ((id: string) => void | Promise<void>) | undefined;
  private onClosed: ((id: string, redistribute: boolean) => void | Promise<void>) | undefined;
  private onSolved: ((id: string) => void | Promise<void>) | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly mainWindow: () => BrowserWindow | null,
    private readonly checkout: CheckoutAutomation = new CheckoutAutomation(),
  ) {}

  setLifecycleHandlers(handlers: {
    onAvailable?: (id: string) => void | Promise<void>;
    onClosed?: (id: string, redistribute: boolean) => void | Promise<void>;
    onSolved?: (id: string) => void | Promise<void>;
  }): void {
    this.onAvailable = handlers.onAvailable;
    this.onClosed = handlers.onClosed;
    this.onSolved = handlers.onSolved;
  }

  private async update(id: string, status: HarvesterStatus, statusMessage: string, patch: Partial<Harvester> = {}): Promise<void> {
    const mutate = (harvester: Harvester) => Object.assign(harvester, patch, { status, statusMessage, updatedAt: new Date().toISOString() });
    const harvester = typeof this.store.updateHarvester === "function"
      ? await this.store.updateHarvester(id, mutate)
      : await (async () => {
          const data = await this.store.load();
          const current = data.harvesters.find((item) => item.id === id);
          if (!current) return undefined;
          mutate(current);
          await this.store.save(data);
          return current;
        })();
    if (!harvester) return;
    this.mainWindow()?.webContents.send("harvester:update", harvester);
  }

  async assign(id: string, requestId: string, taskId: string, taskName: string, challengeUrl: string): Promise<void> {
    if (!permitsChallengeNavigation(challengeUrl)) throw new Error("The task did not provide a valid Pokémon Center CAPTCHA URL.");
    this.assignedChallengeUrls.set(id, challengeUrl);
    await this.update(id, "busy", `Assigned to ${taskName} · solve manually`, {
      assignedRequestId: requestId,
      assignedTaskId: taskId,
    });
    const browser = this.windows.get(id);
    if (browser && !browser.isDestroyed()) await this.showChallenge(id, browser, challengeUrl);
  }

  async release(id: string, message: string): Promise<void> {
    const browser = this.windows.get(id);
    this.assignedChallengeUrls.delete(id);
    this.clearSolveWatcher(id);
    await this.update(id, browser && !browser.isDestroyed() ? "open" : "closed", message, {
      assignedRequestId: undefined,
      assignedTaskId: undefined,
    });
    if (browser && !browser.isDestroyed()) await this.showWaiting(id, browser);
  }

  async incrementSolved(id: string): Promise<void> {
    const harvester = (await this.store.load()).harvesters.find((item) => item.id === id);
    if (!harvester) throw new Error("Harvester not found");
    await this.update(id, "busy", "Challenge solved by user", { solveCount: harvester.solveCount + 1 });
  }

  private clearSolveWatcher(id: string): void {
    const watcher = this.solveWatchers.get(id);
    if (watcher) clearInterval(watcher);
    this.solveWatchers.delete(id);
  }

  private async clearChallengeCss(id: string, browser: BrowserWindow): Promise<void> {
    const key = this.insertedCss.get(id);
    this.insertedCss.delete(id);
    if (key && !browser.isDestroyed()) await browser.webContents.removeInsertedCSS(key).catch(() => undefined);
  }

  private async showWaiting(id: string, browser: BrowserWindow): Promise<void> {
    this.clearSolveWatcher(id);
    await this.clearChallengeCss(id, browser);
    const harvester = (await this.store.load()).harvesters.find((item) => item.id === id);
    if (!harvester || browser.isDestroyed()) return;
    await browser.loadURL(waitingPage(harvester.name));
  }

  private async showChallenge(id: string, browser: BrowserWindow, challengeUrl: string): Promise<void> {
    if (!permitsChallengeNavigation(challengeUrl)) throw new Error("The task did not provide a valid Pokémon Center CAPTCHA URL.");
    this.clearSolveWatcher(id);
    await this.clearChallengeCss(id, browser);
    if (!browser.isDestroyed()) await browser.loadURL(challengeUrl);
  }

  private watchForSolvedChallenge(id: string, browser: BrowserWindow): void {
    this.clearSolveWatcher(id);
    const watcher = setInterval(() => {
      if (browser.isDestroyed() || !this.assignedChallengeUrls.has(id)) {
        this.clearSolveWatcher(id);
        return;
      }
      void browser.webContents.executeJavaScript(`(() => {
        const fields = [
          document.querySelector('textarea[name="h-captcha-response"]'),
          document.querySelector('textarea[name="g-recaptcha-response"]'),
          document.querySelector('input[name="h-captcha-response"]')
        ];
        return fields.some((field) => field && typeof field.value === 'string' && field.value.trim().length > 0);
      })()`, true).then((solved) => {
        if (!solved) return;
        this.clearSolveWatcher(id);
        void this.onSolved?.(id);
      }).catch(() => undefined);
    }, 500);
    this.solveWatchers.set(id, watcher);
  }

  async open(id: string, tileIndex?: number): Promise<void> {
    const existing = this.windows.get(id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      const current = (await this.store.load()).harvesters.find((item) => item.id === id);
      if (current && !current.assignedRequestId) await this.onAvailable?.(id);
      return;
    }

    const harvester = (await this.store.load()).harvesters.find((item) => item.id === id);
    if (!harvester) throw new Error("Harvester not found");
    let proxy;
    try {
      proxy = parseHarvesterProxy(harvester.proxy);
    } catch (error) {
      await this.update(id, "error", error instanceof Error ? error.message : "Invalid harvester proxy");
      return;
    }
    await this.update(id, harvester.assignedRequestId ? "busy" : "opening", harvester.assignedRequestId ? "Opening assigned CAPTCHA" : "Opening CAPTCHA inbox");

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = harvesterBounds(tileIndex ?? this.windows.size, display.workArea);
    const browser = new BrowserWindow({
      ...bounds,
      title: `Brava Harvester · ${harvester.name}`,
      backgroundColor: "#0b0d12",
      autoHideMenuBar: true,
      icon: harvesterIconPath,
      skipTaskbar: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition: `persist:brava-harvester-${id}`,
      },
    });
    browser.setAppDetails({ appId: "com.brava.companion", appIconPath: process.execPath, appIconIndex: 0 });
    this.windows.set(id, browser);

    if (proxy?.username) {
      browser.webContents.on("login", (event, _details, authInfo, callback) => {
        if (!authInfo.isProxy) return;
        event.preventDefault();
        callback(proxy.username, proxy.password);
      });
    }

    browser.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("data:text/html") && !permitsChallengeNavigation(url)) event.preventDefault();
    });
    browser.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browser.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      browser.setTitle(`Brava Harvester · ${harvester.name}`);
    });
    browser.webContents.on("did-finish-load", () => {
      browser.show();
      void (async () => {
        const assignedUrl = this.assignedChallengeUrls.get(id);
        const currentUrl = browser.webContents.getURL();
        if (permitsChallengeNavigation(currentUrl)) {
          if (!assignedUrl) {
            await this.showWaiting(id, browser);
            return;
          }
          await this.clearChallengeCss(id, browser);
          const cssKey = await browser.webContents.insertCSS(challengeOnlyCss);
          this.insertedCss.set(id, cssKey);
          await this.update(id, "busy", "CAPTCHA ready · solve manually");
          this.watchForSolvedChallenge(id, browser);
          return;
        }
        await this.update(id, "open", "Waiting for CAPTCHA");
        if (!assignedUrl) await this.onAvailable?.(id);
      })();
    });
    browser.webContents.on("did-fail-load", (_event, code, description) => {
      if (code !== -3) void this.update(id, "error", `CAPTCHA failed to load · ${description}`);
    });
    browser.on("closed", () => {
      this.windows.delete(id);
      this.assignedChallengeUrls.delete(id);
      this.clearSolveWatcher(id);
      this.insertedCss.delete(id);
      if (!this.closingAll) void (async () => {
        await this.update(id, "closed", "Harvester window closed");
        await this.onClosed?.(id, true);
      })();
    });

    try {
      await browser.webContents.session.setProxy(proxy
        ? { mode: "fixed_servers", proxyRules: `${proxy.protocol}://${proxy.host}:${proxy.port}` }
        : { mode: "direct" });
      const assignedUrl = this.assignedChallengeUrls.get(id);
      if (assignedUrl) await browser.loadURL(assignedUrl);
      else await browser.loadURL(waitingPage(harvester.name));
    } catch (error) {
      await this.update(id, "error", error instanceof Error ? error.message : "CAPTCHA inbox failed to load");
    }
  }

  async close(id: string): Promise<void> {
    const browser = this.windows.get(id);
    if (browser && !browser.isDestroyed()) browser.close();
    else {
      await this.update(id, "closed", "Harvester window closed");
      await this.onClosed?.(id, true);
    }
  }

  async reloadCaptcha(id: string): Promise<void> {
    const challengeUrl = this.assignedChallengeUrls.get(id);
    if (!challengeUrl) throw new Error("This harvester does not have a task-assigned CAPTCHA.");
    const browser = this.windows.get(id);
    if (!browser || browser.isDestroyed()) {
      await this.open(id);
      return;
    }
    await this.showChallenge(id, browser, challengeUrl);
    browser.show();
    browser.focus();
  }

  async testCaptcha(id: string): Promise<void> {
    // A test never invents a challenge or opens the storefront. It only re-opens
    // the real CAPTCHA URL currently assigned by a running task.
    await this.reloadCaptcha(id);
  }

  async openAll(): Promise<void> {
    const harvesters = (await this.store.load()).harvesters;
    for (const [index, harvester] of harvesters.entries()) await this.open(harvester.id, index);
  }

  async closeAll(): Promise<void> {
    this.closingAll = true;
    const ids = [...this.windows.keys()];
    for (const browser of this.windows.values()) if (!browser.isDestroyed()) browser.close();
    this.windows.clear();
    this.closingAll = false;
    for (const id of ids) {
      await this.update(id, "closed", "Harvester window closed");
      await this.onClosed?.(id, false);
    }
  }

  async markSolved(id: string): Promise<void> {
    await this.incrementSolved(id);
  }

  /**
   * Hands-free checkout: lift the CAPTCHA cocoon, make sure the window is on the
   * product page, drive add-to-cart → autofill → place-order, then release the
   * harvester. The window stays on the live page so a human can take over if the
   * automation declines.
   */
  async runCheckout(id: string, task: Task, profile: Parameters<typeof buildCheckoutFields>[0]): Promise<CheckoutOutcome> {
    const browser = this.windows.get(id);
    if (!browser || browser.isDestroyed()) {
      return { status: "declined", message: "The harvester window closed before checkout could start; restart the task to retry." };
    }
    this.clearSolveWatcher(id);
    await this.clearChallengeCss(id, browser);
    await this.update(id, "busy", "Automatic checkout running", { assignedTaskId: task.id });
    try {
      const currentUrl = browser.webContents.getURL();
      const onProductPage = permitsChallengeNavigation(currentUrl) && currentUrl.includes("/product/");
      if (!onProductPage) {
        if (!permitsChallengeNavigation(task.productUrl)) throw new Error("the task has no official product URL to open");
        await browser.webContents.loadURL(task.productUrl);
        await browser.webContents.executeJavaScript("document.readyState === 'complete' || new Promise((resolve) => addEventListener('load', resolve, { once: true }))", true).catch(() => undefined);
      }
      const outcome = await this.checkout.run(task, profile, browser.webContents);
      const assigned = this.assignedChallengeUrls.get(id);
      await this.update(id, browser.isDestroyed() ? "closed" : "open", outcome.status === "completed" ? `Checkout complete · ${outcome.message}` : "Checkout paused · continue manually", { assignedRequestId: undefined, assignedTaskId: undefined });
      if (assigned) this.assignedChallengeUrls.delete(id);
      if (assigned) await this.showWaiting(id, browser);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automatic checkout failed";
      await this.update(id, browser.isDestroyed() ? "closed" : "open", `Checkout paused · ${message}`, { assignedRequestId: undefined, assignedTaskId: undefined });
      return { status: "declined", message };
    }
  }

  async openOnLaunch(): Promise<void> {
    const harvesters = (await this.store.load()).harvesters.filter((item) => item.openOnLaunch);
    for (const [index, harvester] of harvesters.entries()) await this.open(harvester.id, index);
  }
}
