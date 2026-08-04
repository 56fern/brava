import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Harvester, Task } from "../src/shared/types.js";
import type { AppStore } from "../src/main/store.js";
import type { ChallengeHarvesterPort } from "../src/main/challenge-broker.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

const task = (id: string): Task => ({
  id,
  name: id,
  productUrl: `https://www.pokemoncenter.com/product/${id}`,
  sku: id,
  variant: "Any",
  quantity: 1,
  profileId: "",
  proxyId: "",
  status: "awaiting_user",
  statusMessage: "Waiting",
  updatedAt: new Date(0).toISOString(),
  history: [],
  challengeUrl: `https://www.pokemoncenter.com/challenge/${id}`,
});
const challengeUrl = (id: string) => `https://www.pokemoncenter.com/challenge/${id}`;

const harvester = (id: string): Harvester => ({
  id,
  name: id,
  proxy: "",
  status: "idle",
  statusMessage: "Ready",
  solveCount: 0,
  openOnLaunch: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

function harness(taskIds: string[], harvesterIds: string[]) {
  let disk: AppData = {
    profiles: [], proxies: [], taskGroups: [],
    tasks: taskIds.map(task),
    harvesters: harvesterIds.map(harvester),
  };
  const store = {
    load: vi.fn(async () => structuredClone(disk)),
    save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return structuredClone(disk); }),
    getTask: vi.fn(async (id: string) => structuredClone(disk.tasks.find((item) => item.id === id))),
    updateTask: vi.fn(async (id: string, mutate: (value: Task) => void) => {
      const current = disk.tasks.find((item) => item.id === id);
      if (!current) return undefined;
      mutate(current);
      return structuredClone(current);
    }),
  } as unknown as AppStore;
  const port: ChallengeHarvesterPort = {
    open: vi.fn(async () => undefined),
    assign: vi.fn(async (harvesterId, requestId, taskId) => {
      const current = disk.harvesters.find((item) => item.id === harvesterId)!;
      Object.assign(current, { status: "busy", assignedRequestId: requestId, assignedTaskId: taskId });
    }),
    release: vi.fn(async (harvesterId) => {
      const current = disk.harvesters.find((item) => item.id === harvesterId)!;
      Object.assign(current, { status: "open", assignedRequestId: undefined, assignedTaskId: undefined });
    }),
    incrementSolved: vi.fn(async (harvesterId) => {
      const current = disk.harvesters.find((item) => item.id === harvesterId)!;
      current.solveCount += 1;
    }),
  };
  return { store, port, disk: () => disk };
}

describe("ChallengeBroker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("assigns FIFO requests one per harvester and advances after a manual solve", async () => {
    const { store, port, disk } = harness(["task-1", "task-2", "task-3"], ["harvester-1", "harvester-2"]);
    const send = vi.fn();
    const { ChallengeBroker } = await import("../src/main/challenge-broker.js");
    const broker = new ChallengeBroker(store, () => ({ webContents: { send } }) as never, port);

    await broker.request("task-1", 0, challengeUrl("task-1"));
    await broker.request("task-2", 0, challengeUrl("task-2"));
    await broker.request("task-3", 0, challengeUrl("task-3"));

    expect(port.assign).toHaveBeenCalledWith("harvester-1", expect.any(String), "task-1", "task-1", challengeUrl("task-1"));

    expect(broker.snapshot()).toMatchObject({ assigned: 2, queued: 1, testMode: false });
    expect(disk().tasks.find((item) => item.id === "task-1")).toMatchObject({ challengeStatus: "assigned", assignedHarvesterId: "harvester-1" });
    expect(disk().tasks.find((item) => item.id === "task-2")).toMatchObject({ challengeStatus: "assigned", assignedHarvesterId: "harvester-2" });
    expect(disk().tasks.find((item) => item.id === "task-3")).toMatchObject({ challengeStatus: "queued" });

    await broker.solve("harvester-1");

    expect(disk().tasks.find((item) => item.id === "task-1")).toMatchObject({ challengeStatus: "solved" });
    expect(disk().tasks.find((item) => item.id === "task-3")).toMatchObject({ challengeStatus: "assigned", assignedHarvesterId: "harvester-1" });
    expect(disk().harvesters.find((item) => item.id === "harvester-1")?.solveCount).toBe(1);
    expect(broker.snapshot()).toMatchObject({ assigned: 2, queued: 0 });
    broker.shutdown();
  });

  it("requeues a closed harvester assignment without reopening during close-all", async () => {
    const { store, port, disk } = harness(["task-1"], ["harvester-1"]);
    const { ChallengeBroker } = await import("../src/main/challenge-broker.js");
    const broker = new ChallengeBroker(store, () => null, port);
    await broker.request("task-1", 0, challengeUrl("task-1"));

    await broker.releaseHarvester("harvester-1", false);

    expect(broker.snapshot()).toMatchObject({ assigned: 0, queued: 1 });
    expect(disk().tasks[0]).toMatchObject({ challengeStatus: "queued", assignedHarvesterId: undefined, challengeAttempts: 1 });
    expect(port.open).toHaveBeenCalledTimes(1);
    broker.shutdown();
  });

  it("does not assign a harvester unless a task reports a real official CAPTCHA URL", async () => {
    const { store, port } = harness(["task-1"], ["harvester-1"]);
    const { ChallengeBroker } = await import("../src/main/challenge-broker.js");
    const broker = new ChallengeBroker(store, () => null, port);

    await expect(broker.request("task-1")).rejects.toThrow(/CAPTCHA URL/i);
    expect(port.open).not.toHaveBeenCalled();
    expect(port.assign).not.toHaveBeenCalled();
    broker.shutdown();
  });

  it("clears stale crash assignments and does not requeue challenges already solved", async () => {
    const { store, port, disk } = harness(["task-1", "task-2"], ["harvester-1"]);
    Object.assign(disk().harvesters[0]!, { status: "busy", assignedRequestId: "old-request", assignedTaskId: "task-1" });
    Object.assign(disk().tasks[1]!, { challengeStatus: "solved" });
    const { ChallengeBroker } = await import("../src/main/challenge-broker.js");
    const broker = new ChallengeBroker(store, () => null, port);

    await broker.recover();

    expect(port.release).toHaveBeenCalledWith("harvester-1", expect.stringContaining("restart"));
    expect(disk().tasks[0]).toMatchObject({ challengeStatus: "assigned", assignedHarvesterId: "harvester-1" });
    expect(disk().tasks[1]?.challengeStatus).toBe("solved");
    expect(broker.snapshot().requests.map((request) => request.taskId)).toEqual(["task-1"]);
    broker.shutdown();
  });

  it("runs the mock handler sequentially only when development test mode is explicit", async () => {
    const { store, port, disk } = harness(["task-1", "task-2"], []);
    const { ChallengeBroker } = await import("../src/main/challenge-broker.js");
    const broker = new ChallengeBroker(store, () => null, port, { testMode: true, testDelayMs: 25 });

    await broker.request("task-1");
    await broker.request("task-2");
    expect(broker.snapshot()).toMatchObject({ assigned: 1, queued: 1, testMode: true });

    await vi.advanceTimersByTimeAsync(25);
    expect(disk().tasks.find((item) => item.id === "task-1")?.challengeStatus).toBe("solved");
    expect(broker.snapshot()).toMatchObject({ assigned: 1, queued: 0 });

    await vi.advanceTimersByTimeAsync(25);
    expect(disk().tasks.find((item) => item.id === "task-2")?.challengeStatus).toBe("solved");
    expect(broker.snapshot()).toMatchObject({ assigned: 0, queued: 0 });
    expect(port.open).not.toHaveBeenCalled();
    broker.shutdown();
  });
});
