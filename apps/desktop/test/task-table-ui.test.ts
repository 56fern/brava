import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("task operations table", () => {
  it("shows newly created tasks as Idle and reserves Stopped for stopped tasks", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");

    expect(app).toContain('idle: "Idle"');
    expect(app).toContain('stopped: "Stopped"');
    expect(app).toMatch(/status:\s*"idle",\s*statusMessage:\s*"Ready to start"/);
    expect(app).not.toContain('idle: "Ready"');
  });

  it("keeps the compact operational columns and task options visible", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    for (const heading of ["Mode", "Item/s", "Profile", "Proxy", "Wait for queue", "Loop profiles", "Status", "Actions"]) {
      expect(app).toContain(`<span>${heading}</span>`);
    }
    expect(app).toContain("task-boolean");
    expect(app).toContain("task-status-cell");
    expect(styles).toContain("compact task operations table");
  });

  it("fits task groups in a wider rail and uses the selected site's mark", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(app).toContain('className="manager-sidebar task-group-sidebar"');
    expect(app).toContain("<SiteMark site={group.site} tiny />");
    expect(app).toContain('aria-label="Poké Ball"');
    expect(app).toContain("site={selectedGroup?.site}");
    expect(styles).toContain("grid-template-columns: 240px minmax(0,1fr)");
    expect(styles).toMatch(/\.task-group-list\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(styles).toMatch(/@media \(max-width:\s*1380px\)[\s\S]*?\.task-columns > :nth-child\(4\)\s*\{[^}]*display:\s*none/);
    expect(styles).toMatch(/@media \(max-width:\s*1080px\)[\s\S]*?\.task-columns > :nth-child\(6\)\s*\{[^}]*display:\s*none/);
    expect(styles).toContain(".task-group-button .site-orb");
  });

  it("lets a newly created virtual task row contribute visible list height", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(app).toContain('data-total-rows={tasks.length}');
    expect(app).toContain('style={{ height: tasks.length * taskRowHeight }}');
    expect(styles).toMatch(/\.virtual-task-rows\s*\{[^}]*contain:\s*layout paint style/s);
    expect(styles).not.toMatch(/\.virtual-task-rows\s*\{[^}]*contain:\s*strict/s);
  });

  it("keeps responsive task cells on one row and selected rows light in light mode", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const styles = await readFile(new URL("../src/renderer/src/styles.css", import.meta.url), "utf8");

    expect(app).toContain("const taskRowHeight = 72");
    expect(app).toContain('className="task-proxy-cell"');
    expect(app).toContain("task-loop-cell");
    expect(styles).toMatch(/@media \(max-width: 1380px\)[\s\S]*?\.task-columns > :nth-child\(4\)\s*\{[^}]*display:\s*none !important/s);
    expect(styles).toMatch(/@media \(max-width: 1080px\)[\s\S]*?\.task-columns > :nth-child\(6\)\s*\{[^}]*display:\s*none !important/s);
    expect(styles).toMatch(/html\[data-theme="light"\] \.task-row-context-shell\.context-selected > \.manager-row\s*\{[^}]*background:\s*linear-gradient\(90deg, #eaf5ff, #ffffff\)/s);
    expect(styles).toMatch(/\.virtual-task-rows\s*\{[^}]*padding:\s*7px 5px 5px/s);
    expect(styles).toMatch(/\.virtual-task-window\s*\{[^}]*inset:\s*0 0 auto/s);
    expect(styles).toMatch(/\.manager-row\.task-columns\s*\{[^}]*height:\s*66px[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.task-status-cell\.status\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
  });

  it("provides a group-level Edit all action", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");

    expect(app).toContain(">Edit all</button>");
    expect(app).toContain("setEditingAllTasks(true)");
    expect(app).toContain("Task settings updated with Edit all");
    expect(app).toContain("bulkCount={groupTasks.length}");
  });
});
