import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Task } from "../src/shared/types.js";
import type { AppStore } from "../src/main/store.js";
import { SharedScheduler } from "../src/main/shared-scheduler.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

const task = (index: number): Task => ({
  id: `task-${index}`,
  name: `Load task ${index}`,
  productUrl: "https://www.pokemoncenter.com/product/test",
  sku: `SKU-${index}`,
  variant: "Any",
  quantity: 1,
  profileId: "",
  proxyId: "",
  status: "idle",
  statusMessage: "Ready",
  updatedAt: new Date(0).toISOString(),
  history: [],
});

describe("shared task engine load", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const size of [100, 500, 1_000, 5_000]) {
    it(`schedules ${size.toLocaleString()} jobs with one clock and bounded concurrency`, async () => {
      let active = 0;
      let peak = 0;
      const scheduler = new SharedScheduler(16);
      for (let index = 0; index < size; index += 1) {
        scheduler.schedule(`task-${index}:monitor`, 10, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 2));
          active -= 1;
        });
      }
      expect(scheduler.stats()).toMatchObject({ scheduled: size, timerCount: 1, active: 0 });
      await vi.runAllTimersAsync();
      expect(scheduler.stats()).toMatchObject({ scheduled: 0, queued: 0, active: 0, completed: size, failed: 0, timerCount: 0 });
      expect(peak).toBeLessThanOrEqual(16);
    }, 15_000);
  }

  it("isolates one failed job without stopping neighboring work", async () => {
    const errors: string[] = [];
    const scheduler = new SharedScheduler(2, (key) => errors.push(key));
    scheduler.schedule("one", 0, () => undefined);
    scheduler.schedule("broken", 0, () => { throw new Error("synthetic worker failure"); });
    scheduler.schedule("three", 0, () => undefined);
    await vi.runAllTimersAsync();
    expect(scheduler.stats()).toMatchObject({ completed: 2, failed: 1, active: 0 });
    expect(errors).toEqual(["broken"]);
  });

  it("coalesces 1,000 task changes into one renderer message", async () => {
    const tasks = Array.from({ length: 1_000 }, (_, index) => task(index));
    const data: AppData = { profiles: [], proxies: [], taskGroups: [], tasks, harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(data)),
      save: vi.fn(async (next: AppData) => next),
      updateTask: vi.fn(async (id: string, mutate: (current: Task, currentData: AppData) => void) => {
        const current = data.tasks.find((item) => item.id === id);
        if (!current) return undefined;
        mutate(current, data);
        return structuredClone(current);
      }),
      flush: vi.fn(async () => undefined),
    } as unknown as AppStore;
    const send = vi.fn();
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => ({ webContents: { send } }) as never);
    await Promise.all(tasks.map((item) => runner.markCarted(item.id)));
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(32);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("task:update-batch", expect.arrayContaining([expect.objectContaining({ status: "carted" })]));
    expect(send.mock.calls[0]?.[1]).toHaveLength(1_000);
    await runner.shutdown();
  });
});
