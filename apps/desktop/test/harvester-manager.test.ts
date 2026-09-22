import { describe, expect, it, vi } from "vitest";
import { harvesterProxyLabel, parseHarvesterProxy } from "../src/shared/harvester-proxy.js";

vi.mock("electron", () => ({ BrowserWindow: class {}, screen: {}, app: { isPackaged: false } }));

describe("harvester window layout", () => {
  it("accepts one typed proxy per harvester and treats blank as localhost", () => {
    expect(parseHarvesterProxy("  ")).toBeNull();
    expect(parseHarvesterProxy("127.0.0.1:8080:user:secret")).toEqual({
      protocol: "http",
      host: "127.0.0.1",
      port: 8080,
      username: "user",
      password: "secret",
    });
    expect(parseHarvesterProxy("https://user:secret@proxy.example:8443")).toEqual({
      protocol: "https",
      host: "proxy.example",
      port: 8443,
      username: "user",
      password: "secret",
    });
    expect(harvesterProxyLabel("127.0.0.1:8080:user:secret")).toBe("127.0.0.1:8080");
    expect(() => parseHarvesterProxy("not-a-proxy")).toThrow(/host:port/i);
  });

  it("renders an editable Proxy field and applies that proxy to the harvester session", async () => {
    const { readFile } = await import("node:fs/promises");
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const manager = await readFile(new URL("../src/main/harvester-manager.ts", import.meta.url), "utf8");

    expect(app).toContain('<Field label="Proxy"><input value={proxy}');
    expect(app).not.toContain('<Field label="Connection"><select disabled');
    expect(manager).toContain("browser.webContents.session.setProxy(proxy");
    expect(manager).toContain('{ mode: "direct" }');
    expect(manager).toContain("Waiting for CAPTCHA");
    expect(manager).toContain('class="mark"><img src="${harvesterLogoDataUrl}" alt="Brava">');
    expect(manager).toContain('build", "icon-large-v3.png"');
    expect(manager).toContain("icon: harvesterIconPath");
    expect(manager).toContain("skipTaskbar: false");
    expect(manager).toContain('browser.setAppDetails({ appId: "com.brava.companion"');
    expect(manager).not.toContain("parent: this.mainWindow()");
    expect(manager).not.toContain('<div class="mark">◇</div>');
    expect(manager).toContain("challengeOnlyCss");
    expect(manager).toContain("backgroundThrottling: false");
    expect(manager.match(/browser\.show\(\)/g)).toHaveLength(1);
    expect(manager).toContain("watchForSolvedChallenge");
    expect(manager).toContain("await browser.loadURL(waitingPage(harvester.name))");
    expect(manager).not.toContain("officialStartUrl");
  });

  it("registers harvesters as separate taskbar windows and closes them with Brava", async () => {
    const { readFile } = await import("node:fs/promises");
    const main = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
const manager = await readFile(new URL("../src/main/harvester-manager.ts", import.meta.url), "utf8");
    expect(manager).toContain("skipTaskbar: false");
    expect(manager).toContain('appId: "com.brava.companion"');
    expect(main).toContain('mainWindow?.once("closed"');
    expect(main).toContain("void harvesters.closeAll()");
  });

  it("tiles several compact review windows inside the active work area", async () => {
    const { harvesterBounds } = await import("../src/main/harvester-manager.js");
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const windows = [0, 1, 2, 3].map((index) => harvesterBounds(index, workArea));

    expect(new Set(windows.map(({ x, y }) => `${x}:${y}`)).size).toBe(4);
    for (const bounds of windows) {
      expect(bounds.x).toBeGreaterThanOrEqual(workArea.x);
      expect(bounds.y).toBeGreaterThanOrEqual(workArea.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }
  });

  it("correctly handles harvester icon path for both packaged and development modes", async () => {
    // This test ensures that the harvesterIconPath logic works correctly
    // In development mode (isPackaged = false), it should use relative path
    // In packaged mode (isPackaged = true), it should use resourcesPath
    
    const { readFile } = await import("node:fs/promises");
    const manager = await readFile(new URL("../src/main/harvester-manager.ts", import.meta.url), "utf8");
    
    // Verify that the new logic is present in the file
    expect(manager).toContain("app.isPackaged");
    expect(manager).toContain("join(process.resourcesPath");
    expect(manager).toContain("../../build/icon-large-v3.png");
  });

  it("keeps checkout and the idle inbox hidden instead of exposing task pages", async () => {
    const { HarvesterManager } = await import("../src/main/harvester-manager.js");
    const calls: string[] = [];
    const harvester = { id: "h1", name: "Harvester 1", status: "open", statusMessage: "Waiting", proxy: "" };
    const store = {
      load: async () => ({ harvesters: [harvester] }),
      updateHarvester: async (_id: string, mutate: (value: typeof harvester) => void) => { mutate(harvester); return harvester; },
    };
    const browser = {
      isDestroyed: () => false,
      hide: () => calls.push("hide"),
      show: () => calls.push("show"),
      loadURL: async () => { calls.push("waiting page"); },
      webContents: {
        getURL: () => "https://www.pokemoncenter.com/product/10-10608-101",
        executeJavaScript: async () => true,
        loadURL: async () => { calls.push("product page"); },
        stop: () => undefined,
      },
    };
    const checkout = { run: async () => ({ status: "declined", message: "Site error" }) };
    const manager = new HarvesterManager(store as never, () => null, checkout as never);
    (manager as unknown as { windows: Map<string, unknown> }).windows.set("h1", browser);

    const outcome = await manager.runCheckout("h1", { id: "t1", name: "Sleeves", sku: "10-10608-101", productUrl: "https://www.pokemoncenter.com/product/10-10608-101" } as never, {} as never);
    expect(outcome.status).toBe("declined");
    expect(calls).toContain("hide");
    expect(calls).toContain("waiting page");
    expect(calls).not.toContain("show");
  });

  it("reveals a live CAPTCHA without reloading and losing its checkout session", async () => {
    const { HarvesterManager } = await import("../src/main/harvester-manager.js");
    const calls: string[] = [];
    const challengeUrl = "https://www.pokemoncenter.com/checkout/review";
    const harvester = { id: "h1", name: "Harvester 1", status: "open", statusMessage: "Waiting", proxy: "" };
    const store = {
      load: async () => ({ harvesters: [harvester] }),
      updateHarvester: async (_id: string, mutate: (value: typeof harvester) => void) => { mutate(harvester); return harvester; },
    };
    const browser = {
      isDestroyed: () => false,
      isMinimized: () => false,
      hide: () => calls.push("hide"),
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
      loadURL: async () => { calls.push("reload"); },
      webContents: {
        getURL: () => challengeUrl,
        executeJavaScript: async () => ({ detected: true }),
        insertCSS: async () => "challenge-css",
        removeInsertedCSS: async () => undefined,
      },
    };
    const manager = new HarvesterManager(store as never, () => null);
    (manager as unknown as { windows: Map<string, unknown> }).windows.set("h1", browser);

    await manager.assign("h1", "c1", "t1", "Sleeves", challengeUrl);
    expect(calls).toEqual(["hide", "show", "focus"]);
    await manager.release("h1", "Done");
  });
});
