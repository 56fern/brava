import { describe, expect, it } from "vitest";
import { createTaskBatch } from "../src/shared/task-builder.js";

const input = {
  productInput: "10-12345-678",
  profileIds: ["profile-1", "profile-2", "profile-3", "profile-4", "profile-5"],
  proxyIds: ["proxy-1", "proxy-2"],
  batchQuantity: 2,
  cartQuantity: 10,
  autoApplyMonitorSignal: false,
  waitForQueue: true,
  loopProfiles: true,
};

describe("task builder batches", () => {
  it("multiplies selected profiles by quantity", () => {
    let id = 0;
    const tasks = createTaskBatch(input, () => `task-${++id}`, () => "2026-08-02T00:00:00.000Z");
    expect(tasks).toHaveLength(10);
    expect(tasks.filter((task) => task.profileId === "profile-1")).toHaveLength(2);
    expect(tasks.filter((task) => task.profileId === "profile-5")).toHaveLength(2);
    expect(tasks.every((task) => task.status === "idle" && task.quantity === 10 && task.effectiveQuantity === 10)).toBe(true);
    expect(tasks.map((task) => task.proxyId)).toEqual(["proxy-1", "proxy-2", "proxy-1", "proxy-2", "proxy-1", "proxy-2", "proxy-1", "proxy-2", "proxy-1", "proxy-2"]);
    expect(tasks.every((task) => task.proxyPoolIds?.join(",") === "proxy-1,proxy-2")).toBe(true);
  });

  it("maps one combined input to either SKU or product URL", () => {
    const [skuTask] = createTaskBatch({ ...input, profileIds: [], batchQuantity: 1 }, () => "sku-task");
    const [urlTask] = createTaskBatch({ ...input, productInput: "https://www.pokemoncenter.com/product/example", profileIds: [], batchQuantity: 1 }, () => "url-task");
    expect(skuTask).toMatchObject({ name: "10-12345-678", sku: "10-12345-678", productUrl: "", profileId: "" });
    expect(urlTask).toMatchObject({ name: "https://www.pokemoncenter.com/product/example", sku: "", productUrl: "https://www.pokemoncenter.com/product/example", profileId: "" });
  });

  it("keeps queue refresh automatic and creates idle tasks", () => {
    const [task] = createTaskBatch({ ...input, productInput: "PLACEHOLDER", profileIds: ["profile-1"], batchQuantity: 1 }, () => "task-1", () => "2026-08-02T00:00:00.000Z");
    expect(task).toMatchObject({ name: "PLACEHOLDER", usePlaceholder: true, queueCheckIntervalMinutes: 3, variant: "", monitorKeywords: "PLACEHOLDER", status: "idle" });
  });

  it("uses localhost when no proxy group or proxy is selected", () => {
    const [task] = createTaskBatch({ ...input, profileIds: [], proxyIds: [], batchQuantity: 1 }, () => "local-task");
    expect(task).toMatchObject({ proxyId: "", proxyPoolIds: [] });
  });
});
