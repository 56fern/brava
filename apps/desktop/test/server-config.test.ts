import { describe, expect, it, vi } from "vitest";
import { activate } from "../src/main/license-client.js";
import type { AppStore } from "../src/main/store.js";
import { LOCAL_API_URL, PRODUCTION_API_URL, resolveApiUrl } from "../src/renderer/src/config.js";

describe("desktop server configuration", () => {
  it("uses the public Brava API in packaged builds and localhost in development", () => {
    expect(resolveApiUrl(undefined, false)).toBe(PRODUCTION_API_URL);
    expect(resolveApiUrl(undefined, true)).toBe(LOCAL_API_URL);
    expect(resolveApiUrl("https://example.com/", false)).toBe("https://example.com");
  });

  it("shows a useful activation message when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const store = { getDeviceId: async () => "test-device" } as unknown as AppStore;

    await expect(activate(store, "BRVA-TEST1-TEST2-TEST3-TEST4", PRODUCTION_API_URL))
      .rejects.toThrow("Could not reach Brava's license server");

    vi.unstubAllGlobals();
  });
});
