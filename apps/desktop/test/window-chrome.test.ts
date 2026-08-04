import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("packaged window chrome", () => {
  it("bundles the Brava logo through the renderer asset graph", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain('import bravaLogoUrl from "./assets/brava-logo-v2.png"');
    expect(app).toContain("src={bravaLogoUrl}");
    expect(app).not.toContain('src="./brava-logo.png"');
    expect(app).not.toContain('src="/brava-logo.png"');
  });

  it("provides an explicit draggable title region while keeping controls interactive", async () => {
    const main = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = (await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8")).replaceAll(/\s+/g, " ");
    expect(styles).toMatch(/\.window-drag-region\s*\{[^}]*-webkit-app-region:\s*drag/);
    expect(styles).toMatch(/\.window-controls\s*\{[^}]*-webkit-app-region:\s*no-drag/);
    expect(styles).toMatch(/\.window-drag-region\s*\{[^}]*background:\s*transparent/);
    expect(main).toContain("frame: false");
    expect(main).not.toContain("titleBarOverlay");
    expect(app).toContain('aria-label="Minimize"');
    expect(app).toContain('aria-label={maximized ? "Restore" : "Maximize"}');
    expect(app).toContain('aria-label="Close"');
    expect(app).toContain('className="window-theme-toggle"');
    expect(styles).toMatch(/\.window-drag-region\s*\{[^}]*inset:\s*0 166px auto/);
    expect(styles).toMatch(/\.activation-drag-region\s*\{[^}]*right:\s*166px/);
  });

  it("keeps wheel scrolling while hiding the outer workspace scrollbar", async () => {
    const styles = (await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8")).replaceAll(/\s+/g, " ");
    expect(styles).toMatch(/\.shell\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/main\s*\{[^}]*height:\s*100vh[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/);
    expect(styles).toMatch(/main::-webkit-scrollbar\s*\{[^}]*width:\s*0[^}]*height:\s*0/);
  });

  it("uses one flat, unfaded surface across every workspace tab", async () => {
    const styles = (await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8")).replaceAll(/\s+/g, " ");
    expect(styles).toMatch(/\.top-nav\s*\{[^}]*border-right:\s*0[^}]*background:\s*var\(--workspace-bg\)/);
    expect(styles).toMatch(/\.top-nav::before\s*\{[^}]*display:\s*none/);
    expect(styles).toMatch(/\.manager-shell\s*\{[^}]*background:\s*var\(--workspace-bg\)/);
    expect(styles).toMatch(/\.manager-sidebar\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.manager-main\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/body\s*\{[^}]*background:\s*var\(--workspace-bg\)/);
    expect(styles).not.toContain("radial-gradient(circle at 84% 3%");
    expect(styles).not.toContain("radial-gradient(circle at 52% 110%");
    expect(styles).toContain('html[data-theme="light"] .manager-sidebar { color: #24364a; background: transparent; }');
  });

  it("leaves the sidebar clear instead of showing a live clock", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(app).not.toContain("Clock3");
    expect(app).not.toContain("toLocaleTimeString");
    expect(app).not.toContain('className="clock"');
    expect(styles).not.toContain(".clock");
    expect(styles).toContain(".nav-right { height: auto; margin-top: auto;");
  });

  it("uses the black-and-blue multi-resolution Brava app icon", async () => {
    const main = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const iconBuilder = await readFile(new URL("../scripts/make-app-icon.ps1", import.meta.url), "utf8");
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      build: { files: string[]; win: { icon: string } };
    };
    const png = await readFile(new URL("../build/icon-large-v3.png", import.meta.url));
    const ico = await readFile(new URL("../build/icon-large-v3.ico", import.meta.url));

    expect(main).toContain('build/icon-large-v3.png');
    expect(manifest.build.files).toContain("build/icon-large-v3.png");
    expect(manifest.build.win.icon).toBe("build/icon-large-v3.ico");
    expect(iconBuilder).toContain("brava-logo-light.png");
    expect(iconBuilder).toContain("@(16, 20, 24, 32, 40, 48, 64, 128, 256)");
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(8);
  });

  it("switches between a compact activation window and the full workspace", async () => {
    const main = (await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8")).replaceAll(/\s+/g, " ");
    const preload = await readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8");
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = (await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8")).replaceAll(/\s+/g, " ");

    expect(main).toMatch(/width:\s*460,\s*height:\s*460/);
    expect(main).toContain('ipcMain.handle("window:set-mode"');
    expect(main).toContain("mainWindow.setSize(460, 460, false)");
    expect(main).toContain('mainWindow?.once("unmaximize"');
    expect(main.indexOf("mainWindow.setSize(460, 460, false)")).toBeLessThan(main.indexOf("mainWindow.setResizable(false)"));
    expect(main).toContain("mainWindow.setSize(1280, 820, true)");
    expect(main).toContain("mainWindow.setMinimumSize(1240, 720)");
    expect(preload).toContain('ipcRenderer.invoke("window:set-mode", mode)');
    expect(app).toContain('setMode(session ? "workspace" : "activation")');
    expect(styles).toMatch(/\.activation-card\s*\{[^}]*width:\s*100%[^}]*min-height:\s*100vh/);
    expect(styles).toContain("compact activation square");
    expect(styles).toMatch(/\.activation-drag-region\s*\{[^}]*-webkit-app-region:\s*drag/);
  });
});
