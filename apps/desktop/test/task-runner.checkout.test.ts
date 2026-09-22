import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Task } from "../src/shared/types.js";
import type { AppStore } from "../src/main/store.js";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

describe("TaskRunner checkout automation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("invokes checkout handler for adding_to_cart task with autoCheckout undefined", async () => {
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

    let disk: AppData = { 
      profiles: [
        {
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
            brand: "Visa" as const, 
            number: "4242424242424242", 
            last4: "4242", 
            expiryMonth: "08", 
            expiryYear: "2029", 
            cvv: "123", 
            billingSameAsShipping: true 
          }
        }
      ], 
      proxies: [], 
      taskGroups: [], 
      tasks: [{ 
        ...baseTask(), 
        id: "test-task",
        status: "adding_to_cart",
        assignedHarvesterId: "harvester-1",
        profileId: "profile-1"
      }], 
      harvesters: [] 
    };
    
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
      getTask: vi.fn(async (id: string) => structuredClone(disk.tasks.find((item) => item.id === id))),
      updateTask: vi.fn(async (id: string, mutate: (value: Task) => void) => {
        const current = disk.tasks.find((item) => item.id === id);
        if (!current) return undefined;
        mutate(current);
        return structuredClone(current);
      }),
    } as unknown as AppStore;
    
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    
    // Mock the checkout handlers to verify they are called
    const mockCheckoutHandler = vi.fn(async () => ({ status: "completed", message: "Test completed" }));
    runner.setCheckoutHandlers({ run: mockCheckoutHandler });
    
    // Call beginAutoCheckout - this should not throw an error anymore
    await runner.beginAutoCheckout("test-task", "harvester-1");
    
    // Verify that checkout handler was called exactly once
    expect(mockCheckoutHandler).toHaveBeenCalledTimes(1);
  });

  it("does not invoke checkout handler when autoCheckout is false", async () => {
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

    let disk: AppData = { 
      profiles: [
        {
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
            brand: "Visa" as const, 
            number: "4242424242424242", 
            last4: "4242", 
            expiryMonth: "08", 
            expiryYear: "2029", 
            cvv: "123", 
            billingSameAsShipping: true 
          }
        }
      ], 
      proxies: [], 
      taskGroups: [], 
      tasks: [{ 
        ...baseTask(), 
        id: "test-task",
        status: "adding_to_cart",
        assignedHarvesterId: "harvester-1",
        profileId: "profile-1",
        autoCheckout: false  // Explicitly disabled
      }], 
      harvesters: [] 
    };
    
    const store = {
      load: vi.fn(async () => structuredClone(disk)),
      save: vi.fn(async (next: AppData) => { disk = structuredClone(next); return next; }),
      getTask: vi.fn(async (id: string) => structuredClone(disk.tasks.find((item) => item.id === id))),
      updateTask: vi.fn(async (id: string, mutate: (value: Task) => void) => {
        const current = disk.tasks.find((item) => item.id === id);
        if (!current) return undefined;
        mutate(current);
        return structuredClone(current);
      }),
    } as unknown as AppStore;
    
    const { TaskRunner } = await import("../src/main/task-runner.js");
    const runner = new TaskRunner(store, () => null);
    
    // Mock the checkout handlers to verify they are NOT called
    const mockCheckoutHandler = vi.fn(async () => ({ status: "completed", message: "Test completed" }));
    runner.setCheckoutHandlers({ run: mockCheckoutHandler });
    
    // Call beginAutoCheckout - this should not invoke the handler due to autoCheckout:false
    await runner.beginAutoCheckout("test-task", "harvester-1");
    
    // Verify that checkout handler was NOT called
    expect(mockCheckoutHandler).not.toHaveBeenCalled();
  });
});