import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "../src/shared/types.js";

const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
  app: { getPath: () => paths.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

const task = (id: string, status: Task["status"]): Task => ({
  id, name: id, productUrl: "https://www.pokemoncenter.com/product/test", sku: "TEST", variant: "Any", quantity: 1,
  profileId: "", proxyId: "", status, statusMessage: status, updatedAt: new Date(0).toISOString(), history: [],
});

describe("startup task recovery", () => {
  beforeEach(async () => { paths.userData = await mkdtemp(join(tmpdir(), "brava-recovery-test-")); });
  afterEach(async () => { await rm(paths.userData, { recursive: true, force: true }); });

  it("stops stale CAPTCHA and submission tasks but preserves completed orders", async () => {
    const waiting = { ...task("captcha", "awaiting_user"), challengeStatus: "assigned" as const, challengeUrl: "https://www.pokemoncenter.com/challenge", assignedHarvesterId: "h1", checkoutStage: "confirmation" as const };
    const submitting = { ...task("submitting", "submitting_order"), checkoutStage: "confirmation" as const };
    const completed = task("completed", "completed");
    await writeFile(join(paths.userData, "brava-data.json"), JSON.stringify({
      deviceId: "device", profileGroups: [], proxyGroups: [], profiles: [], proxies: [], taskGroups: [],
      tasks: [waiting, submitting, completed], harvesters: [],
    }), "utf8");
    const { AppStore } = await import("../src/main/store.js");
    const store = new AppStore();

    expect(await store.recoverInterruptedTasks()).toBe(2);
    await store.flush();
    const data = JSON.parse(await readFile(join(paths.userData, "brava-data.json"), "utf8")) as { tasks: Task[] };
    expect(data.tasks.find((item) => item.id === "captcha")?.status).toBe("stopped");
    expect(data.tasks.find((item) => item.id === "captcha")?.challengeStatus).toBeUndefined();
    expect(data.tasks.find((item) => item.id === "captcha")?.challengeUrl).toBeUndefined();
    expect(data.tasks.find((item) => item.id === "captcha")?.assignedHarvesterId).toBeUndefined();
    expect(data.tasks.find((item) => item.id === "captcha")?.checkoutStage).toBeUndefined();
    expect(data.tasks.find((item) => item.id === "submitting")?.status).toBe("stopped");
    expect(data.tasks.find((item) => item.id === "submitting")?.checkoutStage).toBeUndefined();
    expect(data.tasks.find((item) => item.id === "submitting")?.statusMessage).toContain("verify the order");
    expect(data.tasks.find((item) => item.id === "completed")?.status).toBe("completed");
  });
});
