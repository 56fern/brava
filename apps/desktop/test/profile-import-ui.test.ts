import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("profile import UI", () => {
  it("uses an inward download glyph for profile imports", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");

    expect(app).toContain("<Download size={14} />Import");
    expect(app).toContain('className="profile-import-icon"><Download size={18} />');
    expect(app).not.toContain("<Upload size={14} />Import");
  });

  it("offers CSV import only for a selected profile group and confirms before saving", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain('input.accept = ".csv,text/csv"');
    expect(app).toContain("parseProfilesCsv(await file.text(), selectedGroup.id)");
    expect(app).toContain('disabled={!selectedGroup} onClick={chooseCsv}');
    expect(app).toContain("Every row passed validation. Existing profiles will stay unchanged.");
    expect(app).toContain("profiles: [...data.profiles, ...pendingImport.profiles]");
  });

  it("keeps import feedback legible in both themes", async () => {
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");
    expect(styles).toContain(".profile-import-feedback.success");
    expect(styles).toContain(".profile-import-feedback.error");
    expect(styles).toContain('html[data-theme="light"] .profile-import-feedback.success');
    expect(styles).toContain('html[data-theme="light"] .profile-import-feedback.error');
  });
});
