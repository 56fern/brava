import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("resource deletion controls", () => {
  it("adds confirmed bulk deletion to every resource manager", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(app.match(/>Delete all<\/button>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(app).toContain("Delete all tasks");
    expect(app).toContain("Delete all profiles");
    expect(app).toContain("Delete all proxies");
    expect(app).toContain("Delete all harvesters");
    expect(app).toContain("function DeleteConfirmModal(");
  });

  it("supports group deletion and clears deleted assignments from tasks", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain('onDeleteGroup={() => setDeleteTarget("group")}');
    expect(app).toContain('onDelete={(id) => { setSelectedGroupId(id); setDeleteTarget("group"); }}');
    expect(app).toContain('ids.has(task.profileId) ? { ...task, profileId: "" } : task');
    expect(app).toContain('ids.has(task.proxyId) ? { ...task, proxyId: "" } : task');
    expect(app).toContain("group-card-delete");
  });

  it("provides right-click actions for groups and harvester tasks", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain("onContextGroup=");
    expect(app).toContain("Edit task group");
    expect(app).toContain("Duplicate with site");
    expect(app).toContain("onContextMenu={(event) => open(event, item.id)}");
    expect(app).toContain("Edit group");
    expect(app).toContain("Reload CAPTCHA");
    expect(app).toContain("Test CAPTCHA");
    expect(app).toContain("Delete harvester");
  });
});
