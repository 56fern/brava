import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Task } from "../src/shared/types.js";
import type { AppStore } from "../src/main/store.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

const baseTask = (): Task => ({
  id: "task-1",
  name: "Drop task",
  productUrl: "",
  sku: "PLACEHOLDER",
  usePlaceholder: true,
  variant: "Any",
  quantity: 1,
  profileId: "",
  proxyId: "",
  waitForQueue: true,
  offerProfileFallback: true,
  status: "idle",
  statusMessage: "Ready",
  updatedAt: new Date(0).toISOString(),
  history: [],
});

describe("TaskRunner queue workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("does not claim a queue is active until an official queue state is reported", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [baseTask()], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const send = vi.fn();
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => ({ webContents: { send } }) as never);

    await runner.start("task-1");
    expect(disk.tasks[0]?.status).toBe("monitoring");
    expect(disk.tasks[0]?.statusMessage).toContain("queue handling is enabled");
    expect(disk.tasks[0]?.queueStartedAt).toBeUndefined();
    expect(disk.tasks[0]?.queueCheckIntervalMinutes).toBe(3);
    expect(disk.tasks[0]?.queueNextCheckAt).toBeUndefined();

    await runner.updateSku("task-1", "LIVE-123");
    expect(disk.tasks[0]).toMatchObject({ sku: "LIVE-123", usePlaceholder: false, status: "monitoring" });

    await runner.reportQueueState("task-1", true, 418, 600);
    expect(disk.tasks[0]).toMatchObject({ status: "queued", queuePosition: 418, queueEtaSeconds: 600 });
    expect(disk.tasks[0]?.queueStartedAt).toBeTruthy();
    expect(disk.tasks[0]?.queueNextCheckAt).toBe("2026-08-01T12:03:00.000Z");

    await runner.reportQueueState("task-1", false);
    expect(disk.tasks[0]?.status).toBe("monitoring");
    expect(disk.tasks[0]?.statusMessage).toContain("No queue detected");
    expect(disk.tasks[0]?.queueStartedAt).toBeUndefined();
  });

  it("does not wait for a queue when the setting is omitted", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "LIVE-123", waitForQueue: undefined }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.start("task-1");

    expect(disk.tasks[0]?.status).toBe("monitoring");
    expect(disk.tasks[0]?.queueStartedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(disk.tasks[0]?.status).toBe("monitoring");
    expect(disk.tasks[0]?.statusMessage).not.toMatch(/found|adding to cart/i);
  });

  it("uses the official exact-SKU probe without requiring auto-apply", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "10-10608-101", monitorKeywords: "10-10608-101", autoApplyMonitorSignal: false, waitForQueue: false }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    runner.setProductProbe(async () => ({ sequence: 1, id: "official-search", site: "pokemon_center_us", sku: "10-10608-101", name: "Pokémon 30th Celebration Card Sleeves", productUrl: "https://www.pokemoncenter.com/product/10-10608-101/card-sleeves", available: true, source: "official-search", detectedAt: new Date().toISOString() }));

    await runner.start("task-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(disk.tasks[0]).toMatchObject({ status: "found", sku: "10-10608-101", name: "Pokémon 30th Celebration Card Sleeves", productUrl: "https://www.pokemoncenter.com/product/10-10608-101/card-sleeves" });
  });

  it("does not treat the literal placeholder label as a verified product match", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), status: "monitoring", monitorKeywords: "placeholder", autoApplyMonitorSignal: true }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.handleProductSignal({ sequence: 1, id: "signal-placeholder", site: "pokemon_center_us", sku: "10-PLACEHOLDER", name: "Placeholder Collection", productUrl: "https://www.pokemoncenter.com/product/placeholder-collection", available: true, source: "test", detectedAt: new Date().toISOString() });

    expect(disk.tasks[0]?.status).toBe("monitoring");
    expect(disk.tasks[0]?.sku).toBe("PLACEHOLDER");
    expect(disk.tasks[0]?.pendingMonitorSignal).toBeUndefined();
  });

  it("does not claim a cart attempt started from a product signal alone", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "LIVE-123", monitorKeywords: "LIVE-123", autoApplyMonitorSignal: true, waitForQueue: false }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.start("task-1");
    await runner.handleProductSignal({ sequence: 1, id: "signal-cart-timeout", site: "pokemon_center_us", sku: "LIVE-123", name: "Verified product", productUrl: "https://www.pokemoncenter.com/product/live-123", available: true, source: "test", detectedAt: new Date().toISOString() });
    expect(disk.tasks[0]?.status).toBe("found");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(disk.tasks[0]?.status).toBe("found");
  });

  it("never leaves a reported cart attempt stuck when no result arrives", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "LIVE-123", monitorKeywords: "LIVE-123", autoApplyMonitorSignal: true, waitForQueue: false, status: "found" }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.reportCartAttempt("task-1");
    expect(disk.tasks[0]?.status).toBe("adding_to_cart");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(disk.tasks[0]?.status).toBe("error");
    expect(disk.tasks[0]?.statusMessage).toContain("no cart result was received");
  });

  it("cancels the cart timeout when a cart result is confirmed", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "LIVE-123", monitorKeywords: "LIVE-123", autoApplyMonitorSignal: true, waitForQueue: false }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.start("task-1");
    await runner.handleProductSignal({ sequence: 1, id: "signal-cart-confirmed", site: "pokemon_center_us", sku: "LIVE-123", name: "Verified product", productUrl: "https://www.pokemoncenter.com/product/live-123", available: true, source: "test", detectedAt: new Date().toISOString() });
    await runner.reportCartAttempt("task-1");
    await runner.markCarted("task-1");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(disk.tasks[0]?.status).toBe("carted");
  });

  it("records user-confirmed cart, decline, and completion states", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "LIVE-123", waitForQueue: false }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.markCarted("task-1");
    expect(disk.tasks[0]?.status).toBe("carted");
    await runner.decline("task-1");
    expect(disk.tasks[0]?.status).toBe("declined");
    await runner.complete("task-1");
    expect(disk.tasks[0]?.status).toBe("completed");
  });

  it("keeps task review headless and reports when a harvester must be configured", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), status: "awaiting_user" }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.review("task-1", false);

    expect(disk.tasks[0]?.status).toBe("awaiting_user");
    expect(disk.tasks[0]?.statusMessage).toBe("No CAPTCHA is waiting · create a harvester before the next challenge");
  });

  it("keeps harvesters idle until a running task reports an actual CAPTCHA", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), usePlaceholder: false, sku: "LIVE-123", waitForQueue: false }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const request = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    runner.setChallengeHandlers({ request, cancel });

    await runner.start("task-1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(request).not.toHaveBeenCalled();

    const url = "https://www.pokemoncenter.com/challenge/task-1";
    await runner.reportChallenge("task-1", url);
    expect(request).toHaveBeenCalledWith("task-1", url);
    expect(disk.tasks[0]).toMatchObject({ status: "awaiting_user", challengeStatus: "queued", challengeUrl: url });
  });

  it("advances to the next profile after a user-recorded decline when loop profiles is enabled", async () => {
    const profile = (id: string, name: string) => ({ id, name, email: `${id}@example.com`, firstName: name, lastName: "Tester", address1: "1 Main St", address2: "", city: "New York", region: "NY", postalCode: "10001", country: "US", phone: "555-0100" });
    let disk: AppData = { profiles: [profile("profile-1", "Primary"), profile("profile-2", "Backup")], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), profileId: "profile-1", loopProfiles: true, offerProfileFallback: true }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.decline("task-1");

    expect(disk.tasks[0]).toMatchObject({ status: "declined", profileId: "profile-2" });
    expect(disk.tasks[0]?.statusMessage).toContain("Backup selected");
  });

  it("automatically tries the next selected proxy after a connection failure", async () => {
    const proxy = (id: string, name: string) => ({ id, name, protocol: "http" as const, host: "127.0.0.1", port: 8000, username: "", password: "" });
    let disk: AppData = {
      profiles: [],
      proxies: [proxy("proxy-1", "Primary"), proxy("proxy-2", "Backup")],
      taskGroups: [],
      tasks: [{ ...baseTask(), status: "monitoring", proxyId: "proxy-1", proxyPoolIds: ["proxy-1", "proxy-2"] }],
      harvesters: [],
    };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.handleProxyFailure("task-1", "Proxy connection failed");
    expect(disk.tasks[0]).toMatchObject({ status: "monitoring", proxyId: "proxy-2", proxyFailureCount: 1 });
    expect(disk.tasks[0]?.statusMessage).toContain("Backup");

    await runner.handleProxyFailure("task-1", "Proxy connection failed");
    expect(disk.tasks[0]?.status).toBe("error");
    expect(disk.tasks[0]?.statusMessage).toContain("no unused selected proxies remain");
  });

  it("refreshes queue position and ETA without inventing missing values", async () => {
    vi.setSystemTime(new Date("2026-08-01T12:01:00.000Z"));
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{
      ...baseTask(),
      status: "queued",
      queuePosition: 418,
      queueEtaSeconds: 600,
      queueLastCheckedAt: "2026-08-01T12:00:00.000Z",
      queueCheckIntervalMinutes: 3,
    }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.refreshQueue("task-1");

    expect(disk.tasks[0]).toMatchObject({
      status: "queued",
      queuePosition: 418,
      queueEtaSeconds: 540,
      queueLastCheckedAt: "2026-08-01T12:01:00.000Z",
      queueNextCheckAt: "2026-08-01T12:04:00.000Z",
    });
    expect(disk.tasks[0]?.statusMessage).toContain("Queue position #418");
    expect(disk.tasks[0]?.statusMessage).toContain("9 minutes");
  });

  it("offers a matching central monitor signal for user approval", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), status: "monitoring", waitForQueue: false, monitorKeywords: "Celebration Box", autoApplyMonitorSignal: false }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    const signal = { sequence: 1, id: "signal-1", site: "pokemon_center_us" as const, sku: "10-12345-100", name: "Celebration Box", productUrl: "https://www.pokemoncenter.com/product/10-12345-100/celebration-box", available: true, source: "test", detectedAt: new Date().toISOString() };

    await runner.handleProductSignal(signal);
    expect(disk.tasks[0]?.pendingMonitorSignal).toMatchObject({ sku: "10-12345-100" });
    expect(disk.tasks[0]?.sku).toBe("PLACEHOLDER");
    await runner.applyMonitorSignal("task-1");
    expect(disk.tasks[0]).toMatchObject({ sku: "10-12345-100", usePlaceholder: false, productUrl: signal.productUrl });
  });

  it("auto-applies an exact monitor match without dropping a live queue session", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), status: "queued", monitorKeywords: "Celebration Box", autoApplyMonitorSignal: true }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    await runner.handleProductSignal({ sequence: 1, id: "signal-1", site: "pokemon_center_us", sku: "10-12345-100", name: "Celebration Box", productUrl: "https://www.pokemoncenter.com/product/10-12345-100/celebration-box", available: true, source: "test", detectedAt: new Date().toISOString() });
    expect(disk.tasks[0]).toMatchObject({ status: "queued", sku: "10-12345-100", usePlaceholder: false });
    expect(disk.tasks[0]?.statusMessage).toContain("queue tracking continues");
  });

  it("reduces a requested quantity to a discovered Pokémon Center cart limit", async () => {
    let disk: AppData = { profiles: [], proxies: [], taskGroups: [], tasks: [{ ...baseTask(), quantity: 10, effectiveQuantity: 10 }], harvesters: [] };
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
    } as unknown as AppStore;
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);

    await runner.applyCartLimit("task-1", 4);

    expect(disk.tasks[0]).toMatchObject({ quantity: 10, effectiveQuantity: 4, maxCartQuantity: 4 });
    expect(disk.tasks[0]?.statusMessage).toContain("reduced from 10 to 4");
  });
});
