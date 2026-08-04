import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getVirtualRange } from "../src/shared/virtual-window";

describe("profile list virtualization", () => {
  it("renders a bounded window for 3,000 profiles", () => {
    const range = getVirtualRange(3_000, 0, 650, 65, 8);
    expect(range).toEqual({ start: 0, end: 18 });
    expect(range.end - range.start).toBeLessThan(30);
  });

  it("moves the window through the list without rendering every row", () => {
    const middle = getVirtualRange(3_000, 97_500, 650, 65, 8);
    const end = getVirtualRange(3_000, 194_350, 650, 65, 8);
    expect(middle.start).toBe(1_492);
    expect(middle.end - middle.start).toBeLessThan(30);
    expect(end.end).toBe(3_000);
  });

  it("uses the virtual profile table in the active Profiles screen", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const activeProfiles = app.slice(app.indexOf("function Profiles("), app.indexOf("function ProfilesLegacy("));
    expect(activeProfiles).toContain("<VirtualProfileRows");
    expect(activeProfiles).toContain("data-total-rows={profiles.length}");
    expect(activeProfiles).toContain("data-rendered-rows={visible.length}");
  });

  it("animates the list surface without delaying individual virtual rows", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.page-stage \.manager-row\s*\{\s*animation:\s*none/);
    expect(styles).toMatch(/\.page-stage \.manager-rows\s*\{\s*animation:\s*rowReveal/);
  });
});
