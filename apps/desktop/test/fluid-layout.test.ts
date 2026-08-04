import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("fluid desktop layout", () => {
  it("does not center the application pages inside a fixed-width wrapper", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
    const fluidPass = styles.slice(styles.indexOf("Brava 0.23 — fluid maximized workspaces"));

    expect(fluidPass).toContain(".content {");
    expect(fluidPass).toContain("width: 100%;");
    expect(fluidPass).toContain("max-width: none;");
    expect(fluidPass).toContain("margin: 0;");
    expect(fluidPass).toContain(".manager-shell {");
    expect(fluidPass).toContain(".manager-main {");
  });

  it("keeps navigation icons visible at the legacy compact breakpoint", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
    const guard = styles.slice(styles.indexOf("Brava 0.24 — narrow-window navigation guard"));

    expect(guard).toContain("@media (max-width: 1180px)");
    expect(guard).toContain(".top-nav nav button svg");
    expect(guard).toContain("display: block;");
  });
});
