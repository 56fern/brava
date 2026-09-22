import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Profile, Task } from "../src/shared/types.js";
import type { AppStore } from "../src/main/store.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

const profile: Profile = {
  id: "profile-1",
  groupId: "g",
  name: "Jane Doe",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  address1: "1 Main St",
  address2: "",
  city: "New York",
  region: "NY",
  postalCode: "10001",
  country: "US",
  phone: "555-0100",
  payment: {
    cardholderName: "Jane Doe",
    brand: "Visa",
    number: "4242424242424242",
    last4: "4242",
    expiryMonth: "08",
    expiryYear: "2029",
    cvv: "123",
    billingSameAsShipping: true,
  },
};

const checkoutTask = (): Task => ({
  id: "test-task",
  name: "Drop task",
  productUrl: "https://www.pokemoncenter.com/product/test-task",
  sku: "TEST-SKU",
  variant: "Any",
  quantity: 1,
  profileId: profile.id,
  proxyId: "",
  status: "adding_to_cart",
  statusMessage: "CAPTCHA solved",
  updatedAt: new Date(0).toISOString(),
  history: [],
});

function harness(task: Task) {
  let disk: AppData = {
    profiles: [profile],
    proxies: [],
    taskGroups: [],
    tasks: [task],
    harvesters: [],
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
  return { store, disk: () => disk };
}

describe("TaskRunner checkout automation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("completes checkout for an adding_to_cart task", async () => {
    const { store, disk } = harness(checkoutTask());
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    const checkout = vi.fn(async () => ({ status: "completed" as const, message: "Checkout complete", orderNumber: "ORDER-1", amount: 42 }));
    runner.setCheckoutHandlers({ run: checkout });

    await runner.beginAutoCheckout("test-task", "harvester-1");

    expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ id: "test-task" }), expect.objectContaining({ id: "profile-1" }), "harvester-1");
    expect(disk().tasks[0]).toMatchObject({ status: "completed", orderNumber: "ORDER-1", checkoutAmount: 42 });
  });

  it("ignores a legacy autoCheckout false value and still completes checkout", async () => {
    const legacyTask: Task & { autoCheckout: false } = { ...checkoutTask(), autoCheckout: false };
    const { store, disk } = harness(legacyTask);
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    const checkout = vi.fn(async () => ({ status: "completed" as const, message: "Legacy checkout complete" }));
    runner.setCheckoutHandlers({ run: checkout });

    await runner.beginAutoCheckout("test-task", "harvester-legacy");

    expect(checkout).toHaveBeenCalledTimes(1);
    expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ autoCheckout: false }), expect.objectContaining({ id: "profile-1" }), "harvester-legacy");
    expect(disk().tasks[0]?.status).toBe("completed");
  });

  it("starts checkout immediately without inventing a CAPTCHA request", async () => {
    const { store, disk } = harness({ ...checkoutTask(), productUrl: "https://www.pokemoncenter.com/-", status: "found" });
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    const request = vi.fn(async () => undefined);
    runner.setChallengeHandlers({ request, cancel: vi.fn(async () => undefined) });
    const checkout = vi.fn(async () => ({ status: "completed" as const, message: "Checkout complete" }));
    runner.setCheckoutHandlers({ run: checkout });

    await runner.requestAutoCheckout("test-task", "https://www.pokemoncenter.com/-");

    expect(checkout).toHaveBeenCalledTimes(1);
    expect(checkout).toHaveBeenCalledWith(expect.objectContaining({ productUrl: expect.stringContaining("/product/TEST-SKU/") }), expect.anything(), undefined);
    expect(request).not.toHaveBeenCalled();
    expect(disk().tasks[0]?.status).toBe("completed");
  });

  it("queues the real CAPTCHA and resumes checkout after it is solved", async () => {
    const challengeUrl = "https://www.pokemoncenter.com/challenge/test-task";
    const { store, disk } = harness({ ...checkoutTask(), status: "found" });
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    const request = vi.fn(async () => undefined);
    runner.setChallengeHandlers({ request, cancel: vi.fn(async () => undefined) });
    const checkout = vi.fn()
      .mockResolvedValueOnce({ status: "captcha" as const, challengeUrl, harvesterId: "harvester-1", message: "CAPTCHA detected" })
      .mockResolvedValueOnce({ status: "completed" as const, message: "Checkout resumed" });
    runner.setCheckoutHandlers({ run: checkout });

    await runner.requestAutoCheckout("test-task", checkoutTask().productUrl);
    expect(request).toHaveBeenCalledWith("test-task", challengeUrl, "harvester-1");
    expect(disk().tasks[0]).toMatchObject({ status: "awaiting_user", challengeStatus: "queued", challengeUrl });

    const waiting = disk().tasks[0]!;
    waiting.challengeStatus = "solved";
    await runner.beginAutoCheckout("test-task", "harvester-1");

    expect(checkout).toHaveBeenCalledTimes(2);
    expect(disk().tasks[0]?.status).toBe("completed");
  });
});
