import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("appearance themes", () => {
  it("persists a user-selected light or dark theme", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");

    expect(app).toContain('localStorage.getItem("brava-theme")');
    expect(app).toContain("document.documentElement.dataset.theme = theme");
    expect(app).toContain('localStorage.setItem("brava-theme", theme)');
    expect(app).toContain('className="window-theme-toggle"');
    expect(app).toContain('aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}');
    expect(app).toContain('onTheme(theme === "dark" ? "light" : "dark")');
    expect(app).not.toContain('className="theme-quick-toggle"');
    expect(app).not.toContain('aria-label="Color theme"');
  });

  it("persists Analytics profile visibility and privacy blur controls", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(app).toContain('localStorage.getItem("brava-analytics-profiles")');
    expect(app).toContain('localStorage.setItem("brava-analytics-profiles"');
    expect(app).toContain('localStorage.getItem("brava-analytics-privacy")');
    expect(app).toContain('className={`window-privacy-toggle ${privacyBlur ? "active" : ""}`}');
    expect(app).toContain('aria-pressed={showCheckoutProfiles}');
    expect(app).toContain('showProfile={showCheckoutProfiles} privacyBlur={privacyBlur}');
    expect(styles).toContain('.activity-columns.show-profiles,.analytics-task-row.show-profiles');
    expect(styles).toContain('.sensitive-blur');
  });

  it("switches only the logo's neutral blades for each surface", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
    const lightLogo = await readFile(new URL("../src/renderer/src/assets/brava-logo-light.png", import.meta.url));

    expect(app).toContain('import bravaLogoLightUrl from "./assets/brava-logo-light.png"');
    expect(app).toContain('className="logo-on-dark"');
    expect(app).toContain('className="logo-on-light"');
    expect(styles).toContain('html[data-theme="light"] .brand-logo .logo-on-dark');
    expect(styles).toContain('html[data-theme="light"] .brand-logo .logo-on-light');
    expect(lightLogo.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("keeps light-theme text readable across dialogs, managers, settings, and logs", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(styles).toContain("complete light-theme contrast pass");
    expect(styles).toContain('html[data-theme="light"] .task-builder-title h2');
    expect(styles).toContain('html[data-theme="light"] .task-option-card b');
    expect(styles).toContain('html[data-theme="light"] .task-builder-field select:disabled');
    expect(styles).toContain('html[data-theme="light"] .webhook-row label > span');
    expect(styles).toContain('html[data-theme="light"] .license-device-actions b');
    expect(styles).toContain('html[data-theme="light"] .task-log-modal');
    expect(styles).toContain('html[data-theme="light"] .status.queued');
    expect(styles).toContain('html[data-theme="light"] .monitor-strip');
  });

  it("uses neutral modal dimming without washing out light mode", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(app).toContain('function FormCard(');
    expect(app).toContain('return createPortal(<div className="modal-backdrop"');
    expect(app).toContain('Import backup?</h2>');
    expect(app).toContain('</section></div>, document.body)}');
    expect(styles).toContain("background: rgba(2, 7, 14, .62)");
    expect(styles).toContain("background: rgba(22, 38, 56, .24)");
    expect(styles).toContain("backdrop-filter: blur(2px) saturate(.92)");
    expect(styles).not.toContain("#dfe8f1d6");
    expect(styles).not.toContain("#030509e8");
  });

  it("uses icons that match spending, declines, and task creation", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");

    expect(app).toContain('icon={<DollarSign />} label="Total spent"');
    expect(app).toContain('icon={<XCircle />} label="Total declines"');
    const activeBuilder = app.slice(app.indexOf("function TaskForm("), app.indexOf("function TaskFormLegacy("));
    expect(activeBuilder).toContain('<div className="task-builder-icon"><ShoppingCart size={18} /></div>');
  });

  it("keeps the Pokemon Center mark theme-invariant and declines red", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(styles).toContain('html[data-theme="light"] .group-card-select > .site-orb');
    expect(styles).toContain("#ef4f58 0 43%, #171c24 43% 57%, #f3f5f8 57% 100%");
    expect(styles).toContain(".analytics-card.coral { background: linear-gradient(135deg, #bd2747, #ef4f63); }");
  });

  it("fills the maximized analytics workspace down to the bottom edge", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(styles).toContain("full-height analytics and stable virtualized list entry");
    expect(styles).toContain("min-height: calc(100vh - 176px)");
    expect(styles).toContain("grid-template-rows: auto minmax(450px, 1fr)");
    expect(styles).toContain(".activity-panel > .empty");
  });
});
