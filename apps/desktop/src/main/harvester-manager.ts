import { BrowserWindow, screen, app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStore } from "./store.js";
import { CheckoutAutomation } from "./checkout-automation.js";
import type { CheckoutOutcome } from "./checkout-automation.js";
import type { Harvester, HarvesterStatus, Task } from "../shared/types.js";
import { buildCaptchaDetectionScript, buildCheckoutFields } from "../shared/checkout-scripts.js";
import { parseHarvesterProxy } from "../shared/harvester-proxy.js";
import { isPokemonCenterProductUrlForSku, resolvePokemonCenterProductUrl } from "../shared/product-input.js";
import { isPokemonCenterQueuePage, type QueueGateOutcome, type QueueGateUpdate } from "./queue-gate.js";

const officialHosts = new Set(["pokemoncenter.com", "www.pokemoncenter.com"]);
const queueMonitorUrl = "https://www.pokemoncenter.com/";
const queuePollIntervalMs = 1_000;
const queueReloadIntervalMs = 15_000;
const harvesterIconPath = (() => {
  return app.isPackaged
    ? join(process.resourcesPath, "app.asar", "build", "icon-large-v3.png")
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
  body:has(iframe[src*="/bframe"], iframe[title*="reCAPTCHA challenge"], iframe[title*="hCaptcha challenge"], .h-captcha, .g-recaptcha, .cf-turnstile, #challenge-stage)::before { display: none !important; }
  iframe[src*="/bframe"], iframe[title*="reCAPTCHA challenge"], iframe[title*="hCaptcha challenge"], .h-captcha, .g-recaptcha, .cf-turnstile, #challenge-stage,
  iframe[src*="/bframe"] *, iframe[title*="reCAPTCHA challenge"] *, iframe[title*="hCaptcha challenge"] *, .h-captcha *, .g-recaptcha *, .cf-turnstile *, #challenge-stage * {
    visibility: visible !important;
  }
  iframe[src*="/bframe"], iframe[title*="reCAPTCHA challenge"], iframe[title*="hCaptcha challenge"], .h-captcha, .g-recaptcha, .cf-turnstile, #challenge-stage {
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

function permitsStoreNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (officialHosts.has(hostname) || hostname === "queue-it.net" || hostname.endsWith(".queue-it.net"));
  } catch {
    return false;
  }
}

const waitFor = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
  const finish = () => { cleanup(); resolve(); };
  const abort = () => { cleanup(); reject(new DOMException("Task stopped by user", "AbortError")); };
  const timer = setTimeout(finish, ms);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
});

export class HarvesterManager {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly assignedChallengeUrls = new Map<string, string>();
  private readonly solveWatchers = new Map<string, NodeJS.Timeout>();
  private readonly insertedCss = new Map<string, string>();
  private readonly activeCheckouts = new Set<string>();
  private closingAll = false;
  private onAvailable: ((id: string) => void | Promise<void>) | undefined;
  private onClosed: ((id: string, redistribute: boolean) => void | Promise<void>) | undefined;
  private onSolved: ((id: string) => void | Promise<void>) | undefined;
  private onSubmittingOrder: ((taskId: string) => Promise<void>) | undefined;
  private onCarted: ((taskId: string) => Promise<void>) | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly mainWindow: () => BrowserWindow | null,
    private readonly checkout: CheckoutAutomation = new CheckoutAutomation(),
  ) {}

  setLifecycleHandlers(handlers: {
    onAvailable?: (id: string) => void | Promise<void>;
    onClosed?: (id: string, redistribute: boolean) => void | Promise<void>;
    onSolved?: (id: string) => void | Promise<void>;
    onSubmittingOrder?: (taskId: string) => Promise<void>;
    onCarted?: (taskId: string) => Promise<void>;
  }): void {
    this.onAvailable = handlers.onAvailable;
    this.onClosed = handlers.onClosed;
    this.onSolved = handlers.onSolved;
    this.onSubmittingOrder = handlers.onSubmittingOrder;
    this.onCarted = handlers.onCarted;
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
    browser.hide();
    await this.clearChallengeCss(id, browser);
    const harvester = (await this.store.load()).harvesters.find((item) => item.id === id);
    if (!harvester || browser.isDestroyed()) return;
    await browser.loadURL(waitingPage(harvester.name));
  }

  private async showChallenge(id: string, browser: BrowserWindow, challengeUrl: string): Promise<void> {
    if (!permitsChallengeNavigation(challengeUrl)) throw new Error("The task did not provide a valid Pokémon Center CAPTCHA URL.");
    this.clearSolveWatcher(id);
    browser.hide();
    await this.clearChallengeCss(id, browser);
    if (!browser.isDestroyed()) {
      // An embedded CAPTCHA belongs to the live checkout DOM. Reloading the
      // same URL destroys that challenge and can show only a reCAPTCHA badge.
      if (browser.webContents.getURL() === challengeUrl) await this.revealChallenge(id, browser);
      else await browser.loadURL(challengeUrl);
    }
  }

  private async revealChallenge(id: string, browser: BrowserWindow): Promise<void> {
    for (let attempt = 0; attempt < 10 && !browser.isDestroyed() && this.assignedChallengeUrls.has(id) && !this.activeCheckouts.has(id); attempt += 1) {
      const result = await browser.webContents.executeJavaScript(buildCaptchaDetectionScript(), true).catch(() => null) as { detected?: boolean } | null;
      if (result?.detected && !this.activeCheckouts.has(id)) {
        await this.clearChallengeCss(id, browser);
        const cssKey = await browser.webContents.insertCSS(challengeOnlyCss);
        this.insertedCss.set(id, cssKey);
        await this.update(id, "busy", "CAPTCHA ready · solve manually");
        this.watchForSolvedChallenge(id, browser);
        if (browser.isMinimized()) browser.restore();
        browser.show();
        browser.focus();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!browser.isDestroyed() && this.assignedChallengeUrls.has(id) && !this.activeCheckouts.has(id)) {
      await this.update(id, "busy", "No CAPTCHA is visible · verify whether the order already went through before retrying");
    }
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
      // Opening an inbox must not expose the storefront, queue, or checkout.
      // Only an assigned CAPTCHA may bring the harvester to the foreground.
      if (this.assignedChallengeUrls.has(id) && this.insertedCss.has(id) && !this.activeCheckouts.has(id)) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      }
      const current = (await this.store.load()).harvesters.find((item) => item.id === id);
      if (current && !current.assignedRequestId && !current.assignedTaskId) await this.onAvailable?.(id);
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
    const reserved = Boolean(harvester.assignedRequestId || harvester.assignedTaskId);
    await this.update(id, reserved ? "busy" : "opening", harvester.assignedRequestId ? "Opening assigned CAPTCHA" : harvester.assignedTaskId ? "Opening assigned task" : "Opening CAPTCHA inbox");

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
        backgroundThrottling: false,
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
      if (!url.startsWith("data:text/html") && !(this.activeCheckouts.has(id) ? permitsStoreNavigation(url) : permitsChallengeNavigation(url))) event.preventDefault();
    });
    browser.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browser.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      browser.setTitle(`Brava Harvester · ${harvester.name}`);
    });
    browser.webContents.on("did-finish-load", () => {
      void (async () => {
        if (this.activeCheckouts.has(id)) {
          browser.hide();
          await this.clearChallengeCss(id, browser);
          return;
        }
        const assignedUrl = this.assignedChallengeUrls.get(id);
        const currentUrl = browser.webContents.getURL();
        if (permitsChallengeNavigation(currentUrl)) {
          if (!assignedUrl) {
            await this.showWaiting(id, browser);
            return;
          }
          await this.revealChallenge(id, browser);
          return;
        }
        const latest = (await this.store.load()).harvesters.find((item) => item.id === id);
        if (latest?.assignedTaskId) {
          await this.update(id, "busy", latest.statusMessage || "Running assigned task");
          return;
        }
        await this.update(id, "open", "Waiting for CAPTCHA");
        if (!assignedUrl && !latest?.assignedRequestId) await this.onAvailable?.(id);
      })();
    });
    browser.webContents.on("did-fail-load", (_event, code, description) => {
      if (code !== -3) void this.update(id, "error", `CAPTCHA failed to load · ${description}`);
    });
    browser.on("closed", () => {
      this.windows.delete(id);
      this.assignedChallengeUrls.delete(id);
      this.activeCheckouts.delete(id);
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

  /** A new task must not inherit the previous guest cart in this harvester. */
  private async prepareFreshTaskSession(id: string): Promise<void> {
    const browser = this.windows.get(id);
    if (!browser || browser.isDestroyed()) throw new Error("The harvester closed before its cart could be cleared.");
    // Navigate away first so the old checkout page cannot write its cart back
    // while Electron clears cookies, storage, and cache for this partition.
    await this.showWaiting(id, browser);
    await browser.webContents.session.clearData();
  }

  async waitForQueueOnAvailable(task: Task, signal: AbortSignal, onUpdate: (update: QueueGateUpdate) => void | Promise<void>): Promise<QueueGateOutcome> {
    const data = await this.store.load();
    const harvester = data.harvesters.find((item) => item.status !== "busy" && item.status !== "error" && !item.assignedRequestId && !item.assignedTaskId);
    if (!harvester) return { status: "failed", message: "No available harvester can monitor the Pokémon Center queue; open or create a harvester and restart the task." };
    await this.update(harvester.id, "busy", "Starting Pokémon Center queue monitoring", { assignedTaskId: task.id });
    try {
      await this.open(harvester.id);
      await this.prepareFreshTaskSession(harvester.id);
    } catch (error) {
      await this.update(harvester.id, "error", "Could not clear the previous cart", { assignedTaskId: undefined });
      return { status: "failed", message: `Queue monitoring did not start because the previous cart could not be cleared: ${error instanceof Error ? error.message : "unknown error"}` };
    }
    return this.waitForQueue(harvester.id, task, signal, onUpdate);
  }

  private async waitForQueue(id: string, task: Task, signal: AbortSignal, onUpdate: (update: QueueGateUpdate) => void | Promise<void>): Promise<QueueGateOutcome> {
    const browser = this.windows.get(id);
    if (!browser || browser.isDestroyed()) return { status: "failed", message: "The harvester window closed before queue monitoring could start." };
    this.clearSolveWatcher(id);
    browser.hide();
    await this.clearChallengeCss(id, browser);
    this.activeCheckouts.add(id);
    await this.update(id, "busy", "Monitoring for the Pokémon Center queue", { assignedTaskId: task.id });
    const stopNavigation = () => { if (!browser.isDestroyed()) browser.webContents.stop(); };
    signal.addEventListener("abort", stopNavigation, { once: true });
    let passed = false;
    try {
      await browser.webContents.loadURL(queueMonitorUrl);
      let sawQueue = false;
      let lastReloadAt = Date.now();
      await onUpdate({ active: false });
      while (!signal.aborted && !browser.isDestroyed()) {
        const snapshot = await browser.webContents.executeJavaScript(`({ title: document.title || '', bodyText: document.body?.innerText || '' })`, true) as { title?: string; bodyText?: string } | null;
        const currentUrl = browser.webContents.getURL();
        const queueActive = isPokemonCenterQueuePage(currentUrl, snapshot?.title ?? "", snapshot?.bodyText ?? "");
        if (queueActive) {
          if (!sawQueue) await onUpdate({ active: true });
          sawQueue = true;
        } else if (sawQueue && permitsChallengeNavigation(currentUrl)) {
          passed = true;
          await this.update(id, "busy", "Queue passed · opening the task product", { assignedTaskId: task.id });
          return { status: "passed", harvesterId: id };
        } else if (Date.now() - lastReloadAt >= queueReloadIntervalMs) {
          await browser.webContents.loadURL(queueMonitorUrl);
          lastReloadAt = Date.now();
        }
        await waitFor(queuePollIntervalMs, signal);
      }
      return { status: "cancelled" };
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return { status: "cancelled" };
      return { status: "failed", message: `Pokémon Center queue monitoring failed - ${error instanceof Error ? error.message : "unknown error"}` };
    } finally {
      signal.removeEventListener("abort", stopNavigation);
      this.activeCheckouts.delete(id);
      if (!passed && !browser.isDestroyed()) {
        await this.update(id, "open", signal.aborted ? "Queue monitoring stopped" : "Queue monitoring ended", { assignedTaskId: undefined });
        await this.showWaiting(id, browser).catch(() => undefined);
      }
    }
  }

  async runCheckoutOnAvailable(task: Task, profile: Parameters<typeof buildCheckoutFields>[0], signal?: AbortSignal): Promise<CheckoutOutcome> {
    const data = await this.store.load();
    const harvester = data.harvesters.find((item) => item.status !== "busy" && item.status !== "error" && !item.assignedRequestId && !item.assignedTaskId);
    if (!harvester) {
      return { status: "declined", message: "No available harvester can run checkout; open or create a harvester and retry the task." };
    }
    await this.update(harvester.id, "busy", "Starting automatic checkout", { assignedTaskId: task.id });
    try {
      await this.open(harvester.id);
      await this.prepareFreshTaskSession(harvester.id);
    } catch (error) {
      await this.update(harvester.id, "error", "Could not clear the previous cart", { assignedTaskId: undefined });
      return { status: "declined", message: `Checkout did not start because the previous cart could not be cleared: ${error instanceof Error ? error.message : "unknown error"}. Nothing was ordered.` };
    }
    const outcome = await this.runCheckout(harvester.id, task, profile, signal);
    return outcome.status === "captcha" ? { ...outcome, harvesterId: harvester.id } : outcome;
  }

  /**
   * Hands-free checkout in the hidden harvester session. The window becomes
   * visible only if a real CAPTCHA needs manual intervention.
   */
  async runCheckout(id: string, task: Task, profile: Parameters<typeof buildCheckoutFields>[0], signal?: AbortSignal): Promise<CheckoutOutcome> {
    const browser = this.windows.get(id);
    if (!browser || browser.isDestroyed()) {
      return { status: "declined", message: "The harvester window closed before checkout could start; restart the task to retry." };
    }
    if (signal?.aborted) return { status: "cancelled", message: "Checkout stopped by user" };
    this.clearSolveWatcher(id);
    browser.hide();
    await this.clearChallengeCss(id, browser);
    this.activeCheckouts.add(id);
    await this.update(id, "busy", "Automatic checkout running", { assignedTaskId: task.id });
    const stopNavigation = () => { if (!browser.isDestroyed()) browser.webContents.stop(); };
    signal?.addEventListener("abort", stopNavigation, { once: true });
    let outcome: CheckoutOutcome;
    try {
      const currentUrl = browser.webContents.getURL();
      const onProductPage = permitsChallengeNavigation(currentUrl) && isPokemonCenterProductUrlForSku(currentUrl, task.sku);
      if (!onProductPage) {
        const productUrl = resolvePokemonCenterProductUrl(task.productUrl, task.sku, task.name);
        if (!permitsChallengeNavigation(productUrl)) throw new Error("the task has no official product URL to open");
        if (signal?.aborted) throw new DOMException("Checkout stopped by user", "AbortError");
        await browser.webContents.loadURL(productUrl);
        if (signal?.aborted) throw new DOMException("Checkout stopped by user", "AbortError");
        await browser.webContents.executeJavaScript("document.readyState === 'complete' || new Promise((resolve) => addEventListener('load', resolve, { once: true }))", true).catch(() => undefined);
      }
      outcome = await this.checkout.run(task, profile, browser.webContents, signal, () => this.onSubmittingOrder?.(task.id) ?? Promise.resolve(), () => this.onCarted?.(task.id) ?? Promise.resolve());
    } catch (error) {
      outcome = signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
        ? { status: "cancelled", message: "Checkout stopped by user" }
        : { status: "declined", message: error instanceof Error ? error.message : "Automatic checkout failed" };
    } finally {
      signal?.removeEventListener("abort", stopNavigation);
      this.activeCheckouts.delete(id);
    }
    const assigned = this.assignedChallengeUrls.get(id);
    await this.update(id, browser.isDestroyed() ? "closed" : "open", outcome.status === "completed" ? `Checkout complete · ${outcome.message}` : outcome.status === "captcha" ? "CAPTCHA detected · waiting for the user" : outcome.status === "cancelled" ? "Checkout stopped" : "Checkout ended · check task logs", { assignedRequestId: undefined, assignedTaskId: undefined });
    if (assigned && outcome.status !== "captcha") this.assignedChallengeUrls.delete(id);
    if (!browser.isDestroyed() && outcome.status !== "captcha") await this.showWaiting(id, browser).catch(() => undefined);
    return outcome.status === "captcha" ? { ...outcome, harvesterId: id } : outcome;
  }

  async openOnLaunch(): Promise<void> {
    const harvesters = (await this.store.load()).harvesters.filter((item) => item.openOnLaunch);
    for (const [index, harvester] of harvesters.entries()) await this.open(harvester.id, index);
  }
}
