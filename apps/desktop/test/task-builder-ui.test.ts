import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("simplified task builder UI", () => {
  it("uses one product input, Default mode, plural resource labels, and automatic queue timing", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const activeBuilder = app.slice(app.indexOf("function TaskForm("), app.indexOf("function TaskFormLegacy("));
    expect(activeBuilder).toContain("SKU / Product URL");
    expect(activeBuilder).not.toContain("Task name");
    expect(activeBuilder).not.toContain("form.name");
    expect(activeBuilder).toContain("Cart quantity");
    expect(activeBuilder).toContain("cartQuantity: 1");
    expect(activeBuilder).toContain('value="Default" readOnly');
    expect(activeBuilder).toContain("<span>Profiles</span>");
    expect(activeBuilder).toContain("<span>Proxies</span>");
    expect(activeBuilder).not.toContain("Queue refresh");
    expect(activeBuilder).not.toContain("Variant");
    expect(activeBuilder).not.toContain("Keywords");
    expect(activeBuilder).not.toContain("Network route");
    expect(activeBuilder).not.toContain("Proxy fallback");
    expect(activeBuilder).not.toContain("offerProxyFallback");
    const taskEditor = app.slice(app.indexOf("function TaskEditModal("), app.indexOf("function TaskEditOptions("));
    expect(taskEditor).not.toContain("Task name");
    expect(taskEditor).not.toContain("form.name");
    const activeEditOptions = app.slice(app.indexOf("function TaskEditOptions("), app.indexOf("function TaskEditOptionsLegacy("));
    expect(activeEditOptions).not.toContain("Proxy fallback");
    expect(activeEditOptions).not.toContain("offerProxyFallback");
  });

  it("shows grouped profile and proxy selection with a quantity-backed task count", async () => {
    const app = await readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8");
    const activeBuilder = app.slice(app.indexOf("function TaskForm("), app.indexOf("function TaskFormLegacy("));
    expect(app).toContain("const taskCount = Math.max(1, form.profileIds.length) * form.batchQuantity");
    expect(app).toContain("Create task ({taskCount})");
    expect(app).toContain('aria-label="Task quantity"');
    expect(app).toContain("Task copies");
    expect(app).toContain('aria-multiselectable="true"');
    expect(app).toContain("function GroupedResourceMultiSelect(");
    expect(app).toContain("profileGroups={data.profileGroups}");
    expect(app).toContain("proxyGroups={data.proxyGroups}");
    expect(app).toContain("Select all ${pluralNoun} in ${group.name}");
    expect(app).toContain("proxyIds: [] as string[]");
    expect(activeBuilder).toContain('emptyOptionLabel="Localhost (no proxy)"');
    expect(app).toContain('className={`resource-localhost-option ${selectedIds.length ? "" : "selected"}`}');
    expect(app).toContain("disabled={!items.length && !emptyOptionLabel}");
    expect(app).toContain("onClick={() => onChange([])}");
    expect(app).toContain("function VirtualResourceOptions(");
    expect(app).toContain("createTaskBatch(form)");
  });
});
