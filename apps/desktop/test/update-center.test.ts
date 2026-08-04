import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("update center", () => {
  it("always exposes the installed version and visible check status", async () => {
    const updater = await readFile(new URL("../src/main/updater.ts", import.meta.url), "utf8");
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");

    expect(updater).toContain("currentVersion = app.getVersion()");
    expect(updater).toContain("Update server is offline.");
    expect(app).toContain("Installed v{update.currentVersion}");
    expect(app).toContain("{update.message}");
  });

  it("has a guarded local-feed publishing script", async () => {
    const publisher = await readFile(new URL("../scripts/publish-update-feed.mjs", import.meta.url), "utf8");
    const desktopPackage = await readFile(new URL("../package.json", import.meta.url), "utf8");
    expect(desktopPackage).toContain("release-staging");
    expect(publisher).toContain("if (version !== packageVersion)");
    expect(publisher).toContain("Release blocked: BRAVA_RELEASE_WEBHOOK_URL");
    expect(publisher).toContain("sendReleaseWebhook");
    expect(publisher).toContain(".release-webhook-state.json");
    expect(publisher.indexOf("await sendReleaseWebhook({")).toBeLessThan(publisher.indexOf("renameSync(manifestTemporaryPath"));
    expect(publisher).toContain("Brava-Setup-0.33.0.exe.blockmap");
    expect(publisher).toContain("can then patch or fall back to the complete newest installer in one jump");
  });
});
