import { afterEach, describe, expect, it, vi } from "vitest";
import { activate } from "../src/main/license-client.js";
import { publishPublicCheckout } from "../src/main/public-checkout-client.js";
import type { AppStore } from "../src/main/store.js";
import type { Task } from "../src/shared/types.js";

afterEach(() => vi.unstubAllGlobals());

describe("public checkout client", () => {
  it("uses the active license session and never sends private checkout fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "signed.session.token", license: { label: "Test", expiresAt: null } }) })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    const store = {
      getDeviceId: async () => "device-public-checkout",
      setLicenseKey: async () => undefined,
    } as unknown as AppStore;
    await activate(store, "BRVA-TEST1-TEST2-TEST3-TEST4", "http://127.0.0.1:4310");
    const task: Task = {
      id: "task-public-client",
      name: "Pokemon TCG Box",
      productUrl: "https://www.pokemoncenter.com/product/example",
      sku: "10-12345-100",
      variant: "N/A",
      quantity: 1,
      effectiveQuantity: 1,
      checkoutAmount: 49.99,
      orderNumber: "PRIVATE-ORDER",
      profileId: "private-profile",
      proxyId: "private-proxy",
      status: "completed",
      statusMessage: "done",
      updatedAt: new Date().toISOString(),
    };

    await expect(publishPublicCheckout(task)).resolves.toBe(true);
    const request = fetchMock.mock.calls[1];
    const body = JSON.parse(String(request?.[1]?.body));
    expect(request?.[1]?.headers.authorization).toBe("Bearer signed.session.token");
    expect(body).toMatchObject({ eventId: "task-public-client", site: "pokemon_center_us", quantity: 1, price: 49.99 });
    expect(JSON.stringify(body)).not.toContain("PRIVATE-ORDER");
    expect(JSON.stringify(body)).not.toContain("private-profile");
    expect(JSON.stringify(body)).not.toContain("private-proxy");
  });
});
