import { describe, expect, it, vi } from "vitest";
import { harvesterProxyLabel, parseHarvesterProxy } from "../src/shared/harvester-proxy.js";

vi.mock("electron", () => ({ BrowserWindow: class {}, screen: {} }));

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
});
