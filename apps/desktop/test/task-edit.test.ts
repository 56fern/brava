import { describe, expect, it } from "vitest";
import { buildTaskEditPatch, taskEditFormFor } from "../src/shared/task-edit.js";
import type { Task } from "../src/shared/types.js";

const task: Task = {
  id: "task-1",
  groupId: "group-1",
  name: "Existing task",
  productUrl: "https://www.pokemoncenter.com/",
  sku: "10-10608-101",
  usePlaceholder: false,
  monitorKeywords: "10-10608-101",
  autoApplyMonitorSignal: false,
  variant: "Any",
  quantity: 1,
  effectiveQuantity: 1,
  profileId: "profile-1",
  proxyId: "proxy-1",
  proxyPoolIds: ["proxy-1"],
  waitForQueue: false,
  loopProfiles: false,
  offerProfileFallback: false,
  status: "idle",
  statusMessage: "Ready",
  updatedAt: "2026-09-21T00:00:00.000Z",
};

describe("task editing", () => {
  it("shows an existing SKU ahead of a generic product URL", () => {
    expect(taskEditFormFor(task).productInput).toBe("10-10608-101");
  });

  it("extracts the SKU from a product link when the stored SKU is blank", () => {
    expect(taskEditFormFor({ ...task, sku: "", productUrl: "https://www.pokemoncenter.com/product/10-10608-101/card-sleeves" }).productInput).toBe("10-10608-101");
  });

  it("returns only the profile when only the profile was touched", () => {
    const form = { ...taskEditFormFor(task), profileId: "profile-2" };
    expect(buildTaskEditPatch(form, ["profileId"])).toEqual({ profileId: "profile-2" });
  });

  it("returns only proxy assignment fields when only the proxy was touched", () => {
    const form = { ...taskEditFormFor(task), proxyId: "proxy-2" };
    expect(buildTaskEditPatch(form, ["proxyId"])).toEqual({ proxyId: "proxy-2", proxyPoolIds: ["proxy-2"] });
  });

  it("updates product fields together when the product input was touched", () => {
    const form = { ...taskEditFormFor(task), productInput: "10-99999-999" };
    expect(buildTaskEditPatch(form, ["productInput"])).toEqual({
      name: "10-99999-999",
      productUrl: "",
      sku: "10-99999-999",
      usePlaceholder: false,
      monitorKeywords: "10-99999-999",
      variant: "",
    });
  });

  it("retains the extracted SKU when a product URL is entered", () => {
    const productUrl = "https://www.pokemoncenter.com/product/10-10608-101/card-sleeves";
    const form = { ...taskEditFormFor(task), productInput: productUrl };
    expect(buildTaskEditPatch(form, ["productInput"])).toMatchObject({ productUrl, sku: "10-10608-101" });
  });
});
